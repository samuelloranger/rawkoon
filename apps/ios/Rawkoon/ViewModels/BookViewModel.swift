import Foundation
import Observation
import RawkoonKit

/// Data-state and non-rendering (network/decision/filesystem) logic
/// extracted from `BookView`. Holds no reference to `AppModel` and never
/// reads `@Environment` — every dependency on live app state (the resolved
/// `APIClient`, `model.manifest`, `model.loadLibrary`, `model.absoluteURL`,
/// `model.downloadPlans`, `model.activeEditionId`, `model.player`,
/// `model.openPlayer`, `model.startDownload`, `model.errorMessage`,
/// `model.isAdmin`) is passed in by the view at the call site as `client:
/// APIClient` and/or `model: AppModel`.
///
/// View-state (`activeLane`, `showingPlayer`, `releaseSearchLane`,
/// `previewDocument`, `chapterFilter`, `openingEbookFileId`,
/// `downloadingEbookFileIDs`) stays on `BookView`. `activeLane` in
/// particular cannot be mutated here — `alignedLane(current:)` is a pure
/// function that computes and returns the aligned lane; the view assigns it
/// to its own `@State`.
@MainActor
@Observable
final class BookViewModel {
    let book: BookListItem

    init(book: BookListItem) {
        self.book = book
    }

    var detail: BookDetailItem?
    var loadingDetail = false
    var detailError: String?

    var manifest: BookManifest?
    var loadingManifest = false
    var rescanningManifest = false
    var preparingAudiobookDownload = false
    var loadingPlayer = false
    var manifestError: String?
    var audiobookActionError: String?
    var attemptedAutomaticRecovery = false

    var ebookFiles: [BookEditionFile] = []
    var loadingEbookFiles = false
    var rescanningEbook = false
    var ebookFilesError: String?
    var addingEditionKind: String?

    // MARK: Pure derivations — editions

    var audiobookEdition: BookEditionDetail? {
        detail?.editions.first(where: { $0.kind == "audiobook" })
    }

    var ebookEdition: BookEditionDetail? {
        detail?.editions.first(where: { $0.kind == "ebook" })
    }

    var audiobookEditionId: Int? {
        audiobookEdition?.id ?? book.audiobookEditionId
    }

    /// Falls back to the list item so reading progress still resolves when the
    /// detail request failed but the library already knew the edition.
    var ebookEditionId: Int? {
        ebookEdition?.id ?? book.ebookEditionId
    }

    var ebookStorageEditionId: Int {
        ebookEditionId ?? (1_000_000_000 + book.bookId)
    }

    var hasAudiobookEdition: Bool {
        audiobookEditionId != nil
    }

    var hasEbookEdition: Bool {
        ebookEdition != nil || book.hasEbook
    }

    // MARK: Pure derivations — display

    var factsLine: String? {
        guard let detail else { return nil }
        var parts: [String] = []
        if let published = formattedPublishedDate(detail.publishedDate, year: detail.publishedYear) {
            parts.append(published)
        }
        parts.append(detail.language.uppercased())
        if let name = detail.seriesName, !name.isEmpty {
            let suffix = detail.seriesPosition.map { " #\($0)" } ?? ""
            parts.append("\(name)\(suffix)")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var metadataRows: [(label: String, value: String)] {
        guard let detail else { return [] }
        var rows: [(String, String)] = []
        if let isbn = detail.isbn13, !isbn.isEmpty {
            rows.append(("ISBN-13", isbn))
        }
        if !detail.narrators.isEmpty {
            rows.append(("Narrators", detail.narrators.joined(separator: ", ")))
        }
        if let publisher = detail.publisher, !publisher.isEmpty {
            rows.append(("Publisher", publisher))
        }
        if let pages = detail.pageCount {
            rows.append(("Pages", String(pages)))
        }
        if let rating = detail.rating {
            if let count = detail.ratingCount {
                rows.append(("Rating", "\(String(format: "%.1f", rating)) (\(count))"))
            } else {
                rows.append(("Rating", String(format: "%.1f", rating)))
            }
        }
        if !detail.genres.isEmpty {
            rows.append(("Genres", detail.genres.joined(separator: " · ")))
        }
        return rows
    }

    var audiobookMetrics: [String] {
        let secs = manifest?.totalDurationSecs ?? audiobookEdition?.durationSecs ?? book.audiobookDurationSecs ?? 0
        var parts = [Formatters.durationClock(secs)]
        if let count = manifest?.chapters.count {
            parts.append("\(count) chapters")
        } else if let count = audiobookEdition?.fileCount {
            parts.append("\(count) files")
        } else if book.audiobookFileCount > 0 {
            parts.append("\(book.audiobookFileCount) files")
        }
        return parts
    }

    var ebookMetrics: [String] {
        var parts: [String] = []
        if let count = ebookEdition?.fileCount {
            parts.append("\(count) files")
        }
        if let bestFormat = ebookEdition?.bestFormat {
            parts.append(bestFormat.uppercased())
        }
        if let size = Formatters.bytesStrict(ebookEdition?.totalSizeBytes) {
            parts.append(size)
        }
        let offlineCount = ebookFiles.filter { isEbookDownloaded($0) }.count
        if offlineCount > 0 {
            parts.append("\(offlineCount) offline")
        }
        return parts
    }

    /// The in-app reader unpacks EPUB only. Other formats in the library (the
    /// Harry Potter editions ship a .mobi beside each .epub) are downloadable
    /// but not readable here, and offering Read on them just produces a "not a
    /// valid EPUB container" error.
    func isReadableEbook(_ file: BookEditionFile) -> Bool {
        ebookExtension(for: file) == "epub" || file.format.lowercased() == "epub"
    }

    var preferredEbookFile: BookEditionFile? {
        ebookFiles
            .sorted { left, right in
                ebookFormatRank(left.format) < ebookFormatRank(right.format)
            }
            .first(where: isReadableEbook)
    }

    var canPlayAudiobook: Bool {
        guard let manifest else { return false }
        return !manifest.chapters.isEmpty
    }

    /// Pure decision logic mirroring the original `alignLaneToAvailableEditions()`,
    /// which mutated `activeLane` directly. `activeLane` is view-state, so this
    /// only computes and returns the aligned lane — the view assigns it.
    func alignedLane(current: BookDetailLane) -> BookDetailLane {
        if current == .audiobook, !hasAudiobookEdition, hasEbookEdition {
            return .ebook
        } else if current == .ebook, !hasEbookEdition, hasAudiobookEdition {
            return .audiobook
        }
        return current
    }

    // MARK: Networking / orchestration

    /// The ebook lane loads before the audiobook manifest on purpose.
    ///
    /// A manifest 400 kicks off `recoverManifestAfterRescan()`, and a
    /// server-side rescan of a many-chapter edition re-reads every file's
    /// metadata — tens of seconds on a 60+ file audiobook. With the ebook load
    /// queued behind it, `ebookFiles` stayed empty for that whole window, which
    /// left "Read" disabled and the Files card spinning.
    func refreshAll(model: AppModel, forceManifestRefresh: Bool) async {
        let client = model.api()
        if let client {
            await loadBookDetail(client: client)
        }
        if hasEbookEdition {
            if let client {
                await loadEbookFiles(client: client)
            }
        } else {
            ebookFiles = []
            ebookFilesError = nil
        }
        if hasAudiobookEdition {
            await fetchManifest(model: model, forceRefresh: forceManifestRefresh)
        } else {
            manifest = nil
            manifestError = nil
        }
    }

    func loadBookDetail(client: APIClient) async {
        loadingDetail = true
        detailError = nil
        defer { loadingDetail = false }
        do {
            detail = try await client.bookDetail(bookId: book.bookId)
        } catch let apiError as APIError {
            detailError = message(for: apiError)
        } catch {
            detailError = "Could not load book details."
        }
    }

    enum AddEditionOutcome {
        case succeeded
        case failed
    }

    /// The view sets `activeLane` to `.audiobook`/`.ebook` on `.succeeded`
    /// (matching the original's unconditional post-add assignment) and does
    /// nothing further on `.failed` — the error state is already set here,
    /// exactly as the original inline `addEdition` did.
    func addEdition(client: APIClient, model: AppModel, kind: String) async -> AddEditionOutcome {
        addingEditionKind = kind
        defer { addingEditionKind = nil }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
            await loadBookDetail(client: client)
            if kind == "audiobook" {
                await fetchManifest(model: model, forceRefresh: true)
            } else {
                await loadEbookFiles(client: client)
            }
            return .succeeded
        } catch let apiError as APIError {
            if kind == "audiobook" {
                manifestError = message(for: apiError)
            } else {
                ebookFilesError = message(for: apiError)
            }
            return .failed
        } catch {
            if kind == "audiobook" {
                manifestError = "Could not add audiobook edition."
            } else {
                ebookFilesError = "Could not add ebook edition."
            }
            return .failed
        }
    }

    func fetchManifest(model: AppModel, forceRefresh: Bool = false) async {
        guard let editionId = audiobookEditionId else { return }
        loadingManifest = true
        manifestError = nil
        defer { loadingManifest = false }
        do {
            manifest = try await model.manifest(editionId, forceRefresh: forceRefresh)
            attemptedAutomaticRecovery = false
        } catch let apiError as APIError {
            manifest = nil
            manifestError = message(for: apiError)
            if
                case .http(400) = apiError,
                model.isAdmin,
                !attemptedAutomaticRecovery,
                !forceRefresh
            {
                attemptedAutomaticRecovery = true
                if let client = model.api() {
                    await recoverManifestAfterRescan(client: client, model: model)
                }
            }
        } catch {
            manifest = nil
            manifestError = "Could not load manifest."
        }
    }

    func recoverManifestAfterRescan(client: APIClient, model: AppModel) async {
        guard let editionId = audiobookEditionId else { return }
        rescanningManifest = true
        defer { rescanningManifest = false }

        do {
            _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "audiobook")
            manifest = try await model.manifest(editionId, forceRefresh: true)
            manifestError = nil
            await model.loadLibrary()
            await loadBookDetail(client: client)
        } catch let apiError as APIError {
            manifest = nil
            manifestError = message(for: apiError)
        } catch {
            manifest = nil
            manifestError = "Rescan completed, but chapters are still unavailable."
        }
    }

    func loadEbookFiles(client: APIClient) async {
        guard hasEbookEdition else { return }
        loadingEbookFiles = true
        ebookFilesError = nil
        defer { loadingEbookFiles = false }
        do {
            ebookFiles = try await client.bookEditionFiles(bookId: book.bookId, kind: "ebook")
        } catch let apiError as APIError {
            ebookFiles = []
            ebookFilesError = message(for: apiError)
        } catch {
            ebookFiles = []
            ebookFilesError = "Could not load ebook files."
        }
    }

    func rescanEbookEdition(client: APIClient, model: AppModel) async {
        rescanningEbook = true
        defer { rescanningEbook = false }
        do {
            _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "ebook")
            await model.loadLibrary()
            await loadBookDetail(client: client)
            await loadEbookFiles(client: client)
        } catch let apiError as APIError {
            ebookFilesError = message(for: apiError)
        } catch {
            ebookFilesError = "Could not rescan ebook edition."
        }
    }

    /// Reload sequence run after the release-search sheet is dismissed. Mirrors
    /// the original `.sheet(item:onDismiss:)` closure exactly: `loadBookDetail`
    /// and `loadEbookFiles` each no-op individually when no client is
    /// available, but `fetchManifest` (which doesn't need a client) still runs.
    func onReleaseSearchDismissed(model: AppModel) async {
        await model.loadLibrary()
        if let client = model.api() {
            await loadBookDetail(client: client)
            if hasEbookEdition {
                await loadEbookFiles(client: client)
            }
        }
        if hasAudiobookEdition {
            await fetchManifest(model: model, forceRefresh: true)
        }
    }

    // MARK: Player actions (inline button closures from `audiobookActionButtons`)

    /// Powers the main Play button. Clears any lingering action error before
    /// trying, and surfaces `model.errorMessage` into `audiobookActionError` on
    /// failure — the caller shows the player sheet only when this returns `true`.
    func playAudiobook(model: AppModel) async -> Bool {
        guard let editionId = audiobookEditionId else { return false }
        audiobookActionError = nil
        loadingPlayer = true
        await model.openPlayer(editionId: editionId)
        loadingPlayer = false
        if let error = model.errorMessage {
            audiobookActionError = error
            return false
        }
        return true
    }

    /// Powers a chapter-row tap. Unlike `playAudiobook(model:)`, the original
    /// inline closure never touched `audiobookActionError` on failure — it
    /// just silently declined to present the player sheet.
    func playAudiobook(model: AppModel, chapter: ManifestChapter) async -> Bool {
        guard let editionId = audiobookEditionId else { return false }
        loadingPlayer = true
        await model.openPlayer(editionId: editionId, resumeAt: chapter.startSecs)
        loadingPlayer = false
        return model.errorMessage == nil
    }

    func startAudiobookDownload(model: AppModel) async {
        guard let editionId = audiobookEditionId else { return }
        audiobookActionError = nil
        preparingAudiobookDownload = true
        await model.startDownload(editionId: editionId)
        preparingAudiobookDownload = false
        if let error = model.errorMessage {
            audiobookActionError = error
        }
    }

    // MARK: Ebook file actions

    /// Returns the local file URL on success, or `nil` after recording the
    /// same `ebookFilesError` the original inline closure set. The caller
    /// (the view) owns `openingEbookFileId` and builds `previewDocument`.
    func openEbook(_ file: BookEditionFile, model: AppModel) async -> URL? {
        ebookFilesError = nil
        do {
            return try await ensureLocalEbookFile(file, model: model)
        } catch EbookStorageError.missingRemoteURL {
            ebookFilesError = "This server version cannot provide ebook download links yet."
            return nil
        } catch {
            ebookFilesError = "Read failed. Try refreshing or rescanning this edition."
            return nil
        }
    }

    /// The caller (the view) owns `downloadingEbookFileIDs` — the original
    /// in-flight guard and set membership are view-state.
    func downloadEbook(_ file: BookEditionFile, model: AppModel) async {
        ebookFilesError = nil
        do {
            _ = try await ensureLocalEbookFile(file, model: model)
        } catch EbookStorageError.missingRemoteURL {
            ebookFilesError = "This server version cannot provide ebook download links yet."
        } catch {
            ebookFilesError = "Download failed. Check your connection and try again."
        }
    }

    func ensureLocalEbookFile(_ file: BookEditionFile, model: AppModel) async throws -> URL {
        let localURL = localEbookURL(for: file)
        if FileManager.default.fileExists(atPath: localURL.path) {
            return localURL
        }

        guard remoteEbookURL(for: file, model: model) != nil else {
            throw EbookStorageError.missingRemoteURL
        }
        guard let client = model.api() else {
            throw APIError.unauthorized
        }

        let temporaryURL = try await client.downloadFile(path: file.contentUrl ?? "")

        let parent = localURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)

        if FileManager.default.fileExists(atPath: localURL.path) {
            try FileManager.default.removeItem(at: localURL)
        }

        try FileManager.default.moveItem(at: temporaryURL, to: localURL)
        return localURL
    }

    func remoteEbookURL(for file: BookEditionFile, model: AppModel) -> URL? {
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

    func isChapterDownloaded(_ chapter: ManifestChapter, model: AppModel) -> Bool {
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

    func isCurrentChapter(_ chapter: ManifestChapter, model: AppModel) -> Bool {
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

    func formattedStatus(_ status: String) -> String {
        status
            .split(separator: "_")
            .map(\.capitalized)
            .joined(separator: " ")
    }

    func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            "Sign in required."
        case .http(400):
            "This audiobook is not chapter-ready yet. Run a rescan or grab a chapterized release."
        case let .http(status):
            "Server error (\(status))."
        case .decode:
            "Could not parse server response."
        case .transport:
            "Network error. Check your connection."
        }
    }

    private static let isoDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoDateNoFractionFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let publishedFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        formatter.locale = .autoupdatingCurrent
        return formatter
    }()

    private enum EbookStorageError: Error {
        case missingRemoteURL
    }
}
