import Foundation

/// A read-only ZIP reader, just enough for EPUB.
///
/// EPUB is a ZIP container, and Foundation exposes no unzip API — so rather
/// than take a dependency this parses the central directory itself. Only the
/// two methods the EPUB spec allows are supported: stored (0) and deflate (8).
/// ZIP64 is rejected rather than mis-read; no EPUB approaches 4 GB.
public enum ZipError: Error, Equatable, Sendable {
    case notAZipArchive
    case zip64Unsupported
    case unsupportedCompression(UInt16)
    case corruptEntry(String)
    case entryNotFound(String)
    case inflateFailed(String)
    /// An entry name that would escape the destination directory.
    case unsafeEntryName(String)
}

public struct ZipEntry: Equatable, Sendable {
    public let name: String
    public let compressionMethod: UInt16
    public let compressedSize: Int
    public let uncompressedSize: Int
    /// Offset of the entry's local file header from the start of the archive.
    public let localHeaderOffset: Int

    public var isDirectory: Bool { name.hasSuffix("/") }
}

public struct ZipArchive: Sendable {
    public let entries: [ZipEntry]
    private let data: Data

    private static let endOfCentralDirectorySignature: UInt32 = 0x0605_4b50
    private static let centralDirectorySignature: UInt32 = 0x0201_4b50
    private static let localHeaderSignature: UInt32 = 0x0403_4b50
    private static let zip64Sentinel: UInt32 = 0xFFFF_FFFF

    public init(data: Data) throws {
        self.data = data
        entries = try Self.readCentralDirectory(data)
    }

    public func entry(named name: String) -> ZipEntry? {
        entries.first { $0.name == name }
    }

    /// The decompressed bytes of one entry.
    public func contents(of entry: ZipEntry) throws -> Data {
        // The central directory's name/extra lengths do not have to match the
        // local header's, so the data offset must come from the local header.
        let header = entry.localHeaderOffset
        guard
            data.count >= header + 30,
            Self.readUInt32(data, at: header) == Self.localHeaderSignature
        else {
            throw ZipError.corruptEntry(entry.name)
        }
        let nameLength = Int(Self.readUInt16(data, at: header + 26))
        let extraLength = Int(Self.readUInt16(data, at: header + 28))
        let start = header + 30 + nameLength + extraLength
        let end = start + entry.compressedSize
        guard start >= 0, end <= data.count, start <= end else {
            throw ZipError.corruptEntry(entry.name)
        }
        let payload = data.subdata(in: start..<end)

        switch entry.compressionMethod {
        case 0:
            return payload
        case 8:
            return try Self.inflate(
                payload,
                expectedSize: entry.uncompressedSize,
                name: entry.name
            )
        default:
            throw ZipError.unsupportedCompression(entry.compressionMethod)
        }
    }

    public func contents(ofEntryNamed name: String) throws -> Data {
        guard let entry = entry(named: name) else {
            throw ZipError.entryNotFound(name)
        }
        return try contents(of: entry)
    }

    // MARK: - Central directory

    private static func readCentralDirectory(_ data: Data) throws -> [ZipEntry] {
        guard let eocd = locateEndOfCentralDirectory(data) else {
            throw ZipError.notAZipArchive
        }
        let count = Int(readUInt16(data, at: eocd + 10))
        let directoryOffset = readUInt32(data, at: eocd + 16)
        let directorySize = readUInt32(data, at: eocd + 12)
        if directoryOffset == zip64Sentinel || directorySize == zip64Sentinel {
            throw ZipError.zip64Unsupported
        }

        var cursor = Int(directoryOffset)
        var entries: [ZipEntry] = []
        entries.reserveCapacity(count)

        for _ in 0..<count {
            guard
                data.count >= cursor + 46,
                readUInt32(data, at: cursor) == centralDirectorySignature
            else {
                throw ZipError.notAZipArchive
            }
            let method = readUInt16(data, at: cursor + 10)
            let compressed = readUInt32(data, at: cursor + 20)
            let uncompressed = readUInt32(data, at: cursor + 24)
            let nameLength = Int(readUInt16(data, at: cursor + 28))
            let extraLength = Int(readUInt16(data, at: cursor + 30))
            let commentLength = Int(readUInt16(data, at: cursor + 32))
            let localOffset = readUInt32(data, at: cursor + 42)

            if compressed == zip64Sentinel
                || uncompressed == zip64Sentinel
                || localOffset == zip64Sentinel
            {
                throw ZipError.zip64Unsupported
            }

            let nameStart = cursor + 46
            guard data.count >= nameStart + nameLength else {
                throw ZipError.notAZipArchive
            }
            let nameBytes = data.subdata(in: nameStart..<(nameStart + nameLength))
            // ZIP names are CP437 unless the UTF-8 flag is set; every EPUB in
            // practice is UTF-8, and a lossy decode beats refusing the file.
            let name =
                String(data: nameBytes, encoding: .utf8)
                ?? String(decoding: nameBytes, as: UTF8.self)

            entries.append(
                ZipEntry(
                    name: name,
                    compressionMethod: method,
                    compressedSize: Int(compressed),
                    uncompressedSize: Int(uncompressed),
                    localHeaderOffset: Int(localOffset)
                )
            )
            cursor = nameStart + nameLength + extraLength + commentLength
        }

        return entries
    }

    /// The EOCD sits at the end, but a trailing comment can push it back by up
    /// to 64 KB, so scan backwards for the signature.
    private static func locateEndOfCentralDirectory(_ data: Data) -> Int? {
        let minimum = 22
        guard data.count >= minimum else { return nil }
        let lowerBound = max(0, data.count - minimum - 0xFFFF)
        var offset = data.count - minimum
        while offset >= lowerBound {
            if readUInt32(data, at: offset) == endOfCentralDirectorySignature {
                return offset
            }
            offset -= 1
        }
        return nil
    }

    // MARK: - Inflate

    private static func inflate(
        _ payload: Data,
        expectedSize: Int,
        name: String
    ) throws -> Data {
        if payload.isEmpty { return Data() }
        do {
            return Data(try Inflate.decompress([UInt8](payload), expectedSize: expectedSize))
        } catch {
            throw ZipError.inflateFailed(name)
        }
    }

    // MARK: - Little-endian reads

    private static func readUInt16(_ data: Data, at offset: Int) -> UInt16 {
        guard offset >= 0, offset + 2 <= data.count else { return 0 }
        let base = data.startIndex + offset
        return UInt16(data[base]) | (UInt16(data[base + 1]) << 8)
    }

    private static func readUInt32(_ data: Data, at offset: Int) -> UInt32 {
        guard offset >= 0, offset + 4 <= data.count else { return 0 }
        let base = data.startIndex + offset
        return UInt32(data[base])
            | (UInt32(data[base + 1]) << 8)
            | (UInt32(data[base + 2]) << 16)
            | (UInt32(data[base + 3]) << 24)
    }
}

// MARK: - Extraction

public extension ZipArchive {
    /// Writes every file entry under `destination`, creating directories.
    ///
    /// Entry names are attacker-controlled in principle, so anything that would
    /// escape `destination` is rejected rather than clamped.
    func extract(to destination: URL, fileManager: FileManager = .default) throws {
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        let root = destination.standardizedFileURL.path

        for entry in entries where !entry.isDirectory {
            let relative = try Self.sanitize(entry.name)
            let target = destination.appendingPathComponent(relative).standardizedFileURL
            guard target.path == root || target.path.hasPrefix(root + "/") else {
                throw ZipError.unsafeEntryName(entry.name)
            }
            try fileManager.createDirectory(
                at: target.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let bytes = try contents(of: entry)
            try bytes.write(to: target, options: .atomic)
        }
    }

    static func sanitize(_ name: String) throws -> String {
        let components = name.split(separator: "/", omittingEmptySubsequences: true)
        guard !components.isEmpty, !name.hasPrefix("/"), !name.hasPrefix("\\") else {
            throw ZipError.unsafeEntryName(name)
        }
        for component in components where component == ".." {
            throw ZipError.unsafeEntryName(name)
        }
        return components.joined(separator: "/")
    }
}
