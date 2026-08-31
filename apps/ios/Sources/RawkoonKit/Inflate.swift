import Foundation

/// Raw DEFLATE (RFC 1951) decompression.
///
/// Apple's `Compression` framework does this, but RawkoonKit's tests run on
/// Linux in CI, where that framework does not exist. A dependency-free decoder
/// keeps one implementation on both — and DEFLATE decoding is small enough that
/// the alternative (a platform fork, or an SPM zip dependency) costs more.
public enum InflateError: Error, Equatable, Sendable {
    case truncated
    case invalidBlockType
    case invalidStoredLength
    case invalidCodeLengths
    case invalidSymbol
    case invalidDistance
}

public enum Inflate {
    /// Decompresses a raw DEFLATE stream — no zlib or gzip wrapper.
    public static func decompress(_ input: [UInt8], expectedSize: Int = 0) throws -> [UInt8] {
        var reader = BitReader(input)
        var output: [UInt8] = []
        output.reserveCapacity(expectedSize > 0 ? expectedSize : input.count * 4)

        while true {
            let isFinal = try reader.bit() == 1
            let type = try reader.bits(2)

            switch type {
            case 0:
                try copyStored(&reader, into: &output)
            case 1:
                try inflateBlock(
                    &reader,
                    into: &output,
                    literals: Huffman.fixedLiterals,
                    distances: Huffman.fixedDistances
                )
            case 2:
                let (literals, distances) = try readDynamicTables(&reader)
                try inflateBlock(&reader, into: &output, literals: literals, distances: distances)
            default:
                throw InflateError.invalidBlockType
            }

            if isFinal { break }
        }

        return output
    }

    // MARK: - Blocks

    private static func copyStored(_ reader: inout BitReader, into output: inout [UInt8]) throws {
        reader.alignToByte()
        let length = Int(try reader.uint16())
        let complement = Int(try reader.uint16())
        guard length == (~complement & 0xFFFF) else { throw InflateError.invalidStoredLength }
        try reader.copyBytes(length, into: &output)
    }

    private static func inflateBlock(
        _ reader: inout BitReader,
        into output: inout [UInt8],
        literals: Huffman,
        distances: Huffman
    ) throws {
        while true {
            let symbol = try literals.decode(&reader)
            if symbol < 256 {
                output.append(UInt8(symbol))
                continue
            }
            if symbol == 256 { return }

            let lengthIndex = symbol - 257
            guard lengthIndex < Self.lengthBase.count else { throw InflateError.invalidSymbol }
            let length = Self.lengthBase[lengthIndex] + Int(try reader.bits(Self.lengthExtra[lengthIndex]))

            let distanceSymbol = try distances.decode(&reader)
            guard distanceSymbol < Self.distanceBase.count else { throw InflateError.invalidDistance }
            let distance =
                Self.distanceBase[distanceSymbol]
                + Int(try reader.bits(Self.distanceExtra[distanceSymbol]))
            guard distance > 0, distance <= output.count else { throw InflateError.invalidDistance }

            // Overlapping copies are legal and common (run-length encoding), so
            // this must copy byte by byte rather than as a block.
            var source = output.count - distance
            for _ in 0..<length {
                output.append(output[source])
                source += 1
            }
        }
    }

    private static func readDynamicTables(_ reader: inout BitReader) throws -> (Huffman, Huffman) {
        let literalCount = Int(try reader.bits(5)) + 257
        let distanceCount = Int(try reader.bits(5)) + 1
        let codeLengthCount = Int(try reader.bits(4)) + 4

        var codeLengthLengths = [Int](repeating: 0, count: 19)
        for i in 0..<codeLengthCount {
            codeLengthLengths[Self.codeLengthOrder[i]] = Int(try reader.bits(3))
        }
        let codeLengthTable = try Huffman(lengths: codeLengthLengths)

        var lengths = [Int]()
        lengths.reserveCapacity(literalCount + distanceCount)
        while lengths.count < literalCount + distanceCount {
            let symbol = try codeLengthTable.decode(&reader)
            switch symbol {
            case 0...15:
                lengths.append(symbol)
            case 16:
                guard let previous = lengths.last else { throw InflateError.invalidCodeLengths }
                let repeats = 3 + Int(try reader.bits(2))
                lengths.append(contentsOf: repeatElement(previous, count: repeats))
            case 17:
                let repeats = 3 + Int(try reader.bits(3))
                lengths.append(contentsOf: repeatElement(0, count: repeats))
            case 18:
                let repeats = 11 + Int(try reader.bits(7))
                lengths.append(contentsOf: repeatElement(0, count: repeats))
            default:
                throw InflateError.invalidCodeLengths
            }
        }
        guard lengths.count == literalCount + distanceCount else {
            throw InflateError.invalidCodeLengths
        }

        return (
            try Huffman(lengths: Array(lengths[0..<literalCount])),
            try Huffman(lengths: Array(lengths[literalCount...]))
        )
    }

    // MARK: - RFC 1951 tables

    private static let lengthBase = [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
        35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
    ]
    private static let lengthExtra = [
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
        3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
    ]
    private static let distanceBase = [
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
        257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
    ]
    private static let distanceExtra = [
        0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
    ]
    private static let codeLengthOrder = [
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
    ]
}

// MARK: - Bit reader

/// LSB-first bit reader, as DEFLATE specifies.
struct BitReader {
    private let bytes: [UInt8]
    private var byteIndex = 0
    private var bitIndex = 0

    init(_ bytes: [UInt8]) {
        self.bytes = bytes
    }

    mutating func bit() throws -> UInt32 {
        guard byteIndex < bytes.count else { throw InflateError.truncated }
        let value = (UInt32(bytes[byteIndex]) >> UInt32(bitIndex)) & 1
        bitIndex += 1
        if bitIndex == 8 {
            bitIndex = 0
            byteIndex += 1
        }
        return value
    }

    mutating func bits(_ count: Int) throws -> UInt32 {
        var value: UInt32 = 0
        for shift in 0..<count {
            value |= try bit() << UInt32(shift)
        }
        return value
    }

    mutating func alignToByte() {
        if bitIndex != 0 {
            bitIndex = 0
            byteIndex += 1
        }
    }

    mutating func uint16() throws -> UInt16 {
        let low = try byte()
        let high = try byte()
        return UInt16(low) | (UInt16(high) << 8)
    }

    mutating func byte() throws -> UInt8 {
        alignToByte()
        guard byteIndex < bytes.count else { throw InflateError.truncated }
        let value = bytes[byteIndex]
        byteIndex += 1
        return value
    }

    mutating func copyBytes(_ count: Int, into output: inout [UInt8]) throws {
        alignToByte()
        guard byteIndex + count <= bytes.count else { throw InflateError.truncated }
        output.append(contentsOf: bytes[byteIndex..<(byteIndex + count)])
        byteIndex += count
    }
}

// MARK: - Canonical Huffman

/// Canonical Huffman decoder built from code lengths, decoded one bit at a time.
///
/// The count/offset form from RFC 1951's own sample decoder: `counts[n]` is how
/// many codes have length `n`, and `symbols` holds the symbols ordered by
/// (length, symbol), which is exactly the canonical code assignment.
struct Huffman: Sendable {
    private let counts: [Int]
    private let symbols: [Int]

    init(lengths: [Int]) throws {
        var counts = [Int](repeating: 0, count: 16)
        for length in lengths {
            guard length >= 0, length <= 15 else { throw InflateError.invalidCodeLengths }
            counts[length] += 1
        }
        counts[0] = 0

        var offsets = [Int](repeating: 0, count: 16)
        for length in 1..<15 {
            offsets[length + 1] = offsets[length] + counts[length]
        }

        var symbols = [Int](repeating: 0, count: lengths.count)
        for (symbol, length) in lengths.enumerated() where length != 0 {
            symbols[offsets[length]] = symbol
            offsets[length] += 1
        }

        self.counts = counts
        self.symbols = symbols
    }

    func decode(_ reader: inout BitReader) throws -> Int {
        var code = 0
        var first = 0
        var index = 0

        for length in 1...15 {
            code |= Int(try reader.bit())
            let count = counts[length]
            if code - first < count {
                return symbols[index + (code - first)]
            }
            index += count
            first = (first + count) << 1
            code <<= 1
        }
        throw InflateError.invalidSymbol
    }

    /// RFC 1951 §3.2.6: literals 0–143 are 8 bits, 144–255 are 9, 256–279 are
    /// 7, 280–287 are 8.
    static let fixedLiterals: Huffman = {
        var lengths = [Int](repeating: 8, count: 288)
        for i in 144..<256 { lengths[i] = 9 }
        for i in 256..<280 { lengths[i] = 7 }
        // swiftlint:disable:next force_try - lengths are a compile-time constant
        return try! Huffman(lengths: lengths)
    }()

    static let fixedDistances: Huffman = {
        // swiftlint:disable:next force_try - lengths are a compile-time constant
        try! Huffman(lengths: [Int](repeating: 5, count: 30))
    }()
}
