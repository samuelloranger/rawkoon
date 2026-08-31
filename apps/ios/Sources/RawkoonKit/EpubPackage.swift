import Foundation

/// The reading order of an EPUB, resolved from its container and OPF package.
public struct EpubPackage: Equatable, Sendable {
    public struct Document: Equatable, Sendable {
        /// Path relative to the extracted archive root, e.g. `OEBPS/ch01.xhtml`.
        public let path: String
        public let id: String
    }

    public let title: String?
    /// Spine order: what "next page" means. Never empty on a valid package.
    public let documents: [Document]
    /// Path of the OPF file relative to the archive root.
    public let opfPath: String

    public var firstDocument: Document? { documents.first }
}

public enum EpubError: Error, Equatable, Sendable {
    case missingContainer
    case missingRootfile
    case missingPackage(String)
    case emptySpine
}

public enum EpubParser {
    static let containerPath = "META-INF/container.xml"

    /// Reads `META-INF/container.xml` and the OPF it points at.
    public static func parse(archive: ZipArchive) throws -> EpubPackage {
        guard let containerData = try? archive.contents(ofEntryNamed: containerPath) else {
            throw EpubError.missingContainer
        }
        guard let opfPath = rootfilePath(fromContainer: containerData) else {
            throw EpubError.missingRootfile
        }
        guard let opfData = try? archive.contents(ofEntryNamed: opfPath) else {
            throw EpubError.missingPackage(opfPath)
        }
        return try parsePackage(opfData, opfPath: opfPath)
    }

    /// The `full-path` of the first rootfile in a container document.
    public static func rootfilePath(fromContainer data: Data) -> String? {
        let delegate = ContainerDelegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldProcessNamespaces = true
        parser.parse()
        guard let path = delegate.fullPath, !path.isEmpty else { return nil }
        return normalize(path)
    }

    /// Resolves manifest ids to hrefs, then walks the spine to get the order.
    ///
    /// Manifest hrefs are relative to the OPF's own directory, not the archive
    /// root, so they are rebased here — a mistake that silently yields 404s
    /// inside the reader for every EPUB whose content lives in `OEBPS/`.
    public static func parsePackage(_ data: Data, opfPath: String) throws -> EpubPackage {
        let delegate = PackageDelegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldProcessNamespaces = true
        parser.parse()

        let base = (opfPath as NSString).deletingLastPathComponent
        var documents: [EpubPackage.Document] = []
        var seen = Set<String>()
        for id in delegate.spine {
            guard let href = delegate.manifest[id] else { continue }
            let resolved = resolve(href: href, relativeTo: base)
            guard seen.insert(resolved).inserted else { continue }
            documents.append(EpubPackage.Document(path: resolved, id: id))
        }

        if documents.isEmpty { throw EpubError.emptySpine }

        return EpubPackage(
            title: delegate.title?.trimmingCharacters(in: .whitespacesAndNewlines),
            documents: documents,
            opfPath: opfPath
        )
    }

    /// Joins an OPF-relative href onto the OPF's directory, collapsing `..`
    /// and dropping any fragment or query.
    static func resolve(href: String, relativeTo base: String) -> String {
        var path = href
        if let hash = path.firstIndex(of: "#") { path = String(path[path.startIndex..<hash]) }
        if let query = path.firstIndex(of: "?") { path = String(path[path.startIndex..<query]) }
        let decoded = path.removingPercentEncoding ?? path

        if decoded.hasPrefix("/") { return normalize(String(decoded.dropFirst())) }
        if base.isEmpty { return normalize(decoded) }
        return normalize((base as NSString).appendingPathComponent(decoded))
    }

    static func normalize(_ path: String) -> String {
        var parts: [String] = []
        for component in path.split(separator: "/", omittingEmptySubsequences: true) {
            switch component {
            case ".":
                continue
            case "..":
                if !parts.isEmpty { parts.removeLast() }
            default:
                parts.append(String(component))
            }
        }
        return parts.joined(separator: "/")
    }
}

// MARK: - XML delegates

private final class ContainerDelegate: NSObject, XMLParserDelegate {
    var fullPath: String?

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName: String?,
        attributes: [String: String]
    ) {
        guard fullPath == nil, elementName.lowercased() == "rootfile" else { return }
        fullPath = attributes["full-path"]
    }
}

private final class PackageDelegate: NSObject, XMLParserDelegate {
    /// manifest item id -> href, OPF-relative.
    var manifest: [String: String] = [:]
    /// spine itemref idrefs, in document order.
    var spine: [String] = []
    var title: String?

    private var inMetadataTitle = false
    private var titleBuffer = ""

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName: String?,
        attributes: [String: String]
    ) {
        switch elementName.lowercased() {
        case "item":
            if let id = attributes["id"], let href = attributes["href"] {
                manifest[id] = href
            }
        case "itemref":
            // linear="no" marks material outside the main reading order
            // (colophons, ads). Keep it: dropping it loses real content in
            // EPUBs that mark everything non-linear.
            if let idref = attributes["idref"] {
                spine.append(idref)
            }
        case "title":
            if title == nil {
                inMetadataTitle = true
                titleBuffer = ""
            }
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard inMetadataTitle else { return }
        titleBuffer += string
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName: String?
    ) {
        guard elementName.lowercased() == "title", inMetadataTitle else { return }
        inMetadataTitle = false
        let trimmed = titleBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { title = trimmed }
    }
}
