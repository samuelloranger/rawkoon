import Foundation
import RawkoonKit

extension AppModel {
    /// Resolves the ebook file to read (the preferred one, else the best format),
    /// downloading it when it is not on disk yet. `onlyFormat` limits the choice
    /// to one format, e.g. the epub a handoff position was matched against.
    func ebookDocument(
        bookId: Int,
        editionId: Int,
        title: String,
        preferredFileId: Int? = nil,
        onlyFormat: String? = nil
    ) async throws -> EbookPreviewDocument {
        guard let client = api() else { throw APIError.unauthorized }

        let allFiles = try await client.bookEditionFiles(bookId: bookId, kind: "ebook")
        let files = onlyFormat.map { format in
            allFiles.filter { $0.format.lowercased() == format }
        } ?? allFiles
        guard !files.isEmpty else { throw APIError.http(404) }

        let selected =
            files.first(where: { $0.id == preferredFileId })
                ?? files.min(by: { Self.ebookFormatRank($0.format) < Self.ebookFormatRank($1.format) })
                ?? files[0]

        let localURL = try await ensureLocalEbookFile(selected, editionId: editionId)
        let language = try? await client.bookDetail(bookId: bookId).language
        return EbookPreviewDocument(
            id: selected.id,
            editionId: editionId,
            language: language,
            title: title,
            localURL: localURL,
            bookId: bookId
        )
    }

    func ensureLocalEbookFile(_ file: BookEditionFile, editionId: Int) async throws -> URL {
        let localURL = FileStore.chapterURL(
            editionId: editionId,
            fileId: file.id,
            ext: Self.ebookExtension(for: file)
        )
        if FileManager.default.fileExists(atPath: localURL.path) {
            return localURL
        }

        guard absoluteURL(file.contentUrl) != nil else {
            throw EbookContinueError.missingRemoteURL
        }

        let temporaryURL: URL
        do {
            // NOTE: deliberately surfacing .transport for every failure here to preserve
            // the shipping copy ("Network error…"). The 401→"Sign in required." wording
            // improvement is deferred to the localization phase — see the milestone spec.
            guard let client = api() else { throw APIError.unauthorized }
            temporaryURL = try await client.downloadFile(path: file.contentUrl ?? "")
        } catch {
            Log.network.error("openEbook download failed: \(String(describing: error), privacy: .public)")
            throw APIError.transport
        }

        let parent = localURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: localURL.path) {
            try FileManager.default.removeItem(at: localURL)
        }
        try FileManager.default.moveItem(at: temporaryURL, to: localURL)
        return localURL
    }

    static func ebookExtension(for file: BookEditionFile) -> String {
        let ext = URL(fileURLWithPath: file.fileName).pathExtension.lowercased()
        if !ext.isEmpty {
            return ext
        }
        let normalized = file.format.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        return normalized.isEmpty ? "epub" : normalized
    }

    static func ebookFormatRank(_ format: String) -> Int {
        switch format.lowercased() {
        case "epub": 0
        case "azw3": 1
        case "mobi": 2
        case "pdf": 3
        case "cbz": 4
        default: 99
        }
    }
}

enum EbookContinueError: Error {
    case missingRemoteURL
}
