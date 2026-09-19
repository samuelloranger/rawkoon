import Foundation
import RawkoonKit
import SwiftUI

extension BookView {
    func remoteEbookURL(for file: BookEditionFile) -> URL? {
        guard let contentURL = file.contentUrl else { return nil }
        return model.absoluteURL(contentURL)
    }

    func localEbookURL(for file: BookEditionFile) -> URL {
        FileStore.chapterURL(
            editionId: ebookStorageEditionId,
            fileId: file.id,
            ext: ebookExtension(for: file)
        )
    }

    func isEbookDownloaded(_ file: BookEditionFile) -> Bool {
        FileStore.exists(
            editionId: ebookStorageEditionId,
            fileId: file.id,
            ext: ebookExtension(for: file)
        )
    }

    func ebookExtension(for file: BookEditionFile) -> String {
        // Lowercased on purpose: the library holds both ".epub" and ".EPUB",
        // and the cached copy must land on one name either way.
        let ext = URL(fileURLWithPath: file.fileName).pathExtension.lowercased()
        if !ext.isEmpty {
            return ext
        }
        let normalized = file.format.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        return normalized.isEmpty ? "epub" : normalized
    }

    func ebookFormatRank(_ format: String) -> Int {
        switch format.lowercased() {
        case "epub": 0
        case "azw3": 1
        case "mobi": 2
        case "pdf": 3
        case "cbz": 4
        default: 99
        }
    }

    func fileMeta(_ file: BookEditionFile) -> String {
        var parts: [String] = [file.format.uppercased()]
        if let size = Formatters.bytesStrict(file.sizeBytes) {
            parts.append(size)
        }
        if let bitrate = file.audioBitrate {
            parts.append("\(bitrate) kbps")
        }
        if !file.languageTags.isEmpty {
            parts.append(file.languageTags.joined(separator: ", ").uppercased())
        }
        return parts.joined(separator: " · ")
    }

    func renderedOverviewText(_ rawOverview: String) -> String {
        let trimmed = rawOverview.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("<"), let data = trimmed.data(using: .utf8) else {
            return trimmed
        }
        if let parsed = try? NSAttributedString(
            data: data,
            options: [
                .documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue,
            ],
            documentAttributes: nil
        ) {
            return parsed.string
                .replacingOccurrences(of: "\u{00A0}", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return trimmed
    }

    func isChapterDownloaded(_ chapter: ManifestChapter) -> Bool {
        guard let editionId = audiobookEditionId else { return false }
        if model.downloadPlans[editionId]?.states[chapter.fileId] == .verified {
            return true
        }
        return FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: chapterExtension(chapter))
    }

    func chapterExtension(_ chapter: ManifestChapter) -> String {
        let ext = URL(string: chapter.url)?.pathExtension ?? ""
        return ext.isEmpty ? "bin" : ext
    }

    func isCurrentChapter(_ chapter: ManifestChapter) -> Bool {
        guard let editionId = audiobookEditionId else { return false }
        return model.activeEditionId == editionId && model.player.currentChapterIndex == chapter.index
    }

    func formattedPublishedDate(_ iso: String?, year: Int?) -> String? {
        if let iso,
           let date = Self.isoDateFormatter.date(from: iso) ?? Self.isoDateNoFractionFormatter.date(from: iso)
        {
            return Self.publishedFormatter.string(from: date)
        }
        if let year {
            return String(year)
        }
        return nil
    }

    func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            String(localized: "Sign in required.")
        case .forbidden:
            String(localized: "You don't have permission to do that.")
        case .http(400):
            String(localized: "This audiobook is not chapter-ready yet. Run a rescan or grab a chapterized release.")
        case let .http(status):
            String(localized: "Server error (\(status)).")
        case let .server(_, message):
            message
        case .decode:
            String(localized: "Could not parse server response.")
        case .transport:
            String(localized: "Network error. Check your connection.")
        }
    }

    static let isoDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let isoDateNoFractionFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let publishedFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        formatter.locale = .autoupdatingCurrent
        return formatter
    }()

    enum EbookStorageError: Error {
        case missingRemoteURL
    }
}
