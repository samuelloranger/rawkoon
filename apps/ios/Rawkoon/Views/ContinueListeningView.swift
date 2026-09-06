import RawkoonKit
import SwiftUI

/// In-progress audiobooks and ebooks. Lives on the Home dashboard.
/// Self-loads, so any surface can host it.
struct ContinueListeningView: View {
    @Environment(AppModel.self) private var model

    var refreshToken: Int = 0
    var limit: Int = 6

    @State private var items: [ContinueItem] = []
    @State private var errorMessage: String?
    @State private var openingID: String?
    @State private var busyIds: Set<String> = []
    @State private var showingPlayer = false
    @State private var previewDocument: EbookPreviewDocument?
    @State private var readingBook: BookListItem?

    var body: some View {
        // A bare `if` with no else renders nothing at all, and SwiftUI never
        // runs a `.task` attached to nothing — so the card stayed empty
        // forever, because the only thing that fills it is that task. The
        // zero-size placeholder keeps the view in the hierarchy while hidden.
        Group {
            if errorMessage != nil || !items.isEmpty {
                card
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            } else {
                Color.clear.frame(width: 0, height: 0)
            }
        }
        .task(id: refreshToken) { await load() }
        .sheet(isPresented: $showingPlayer, onDismiss: { Task { await load() } }) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environment(model)
            }
        }
        .sheet(item: $previewDocument, onDismiss: { Task { await load() } }) { document in
            EbookReaderSheet(document: document)
                .environment(model)
        }
        .navigationDestination(isPresented: Binding(
            get: { readingBook != nil },
            set: {
                if !$0 {
                    readingBook = nil
                }
            }
        )) {
            if let book = readingBook {
                BookView(book: book, preferEbook: true)
            }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Continue", systemImage: "bookmark")
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)

            if let errorMessage, items.isEmpty {
                Text(errorMessage)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 10) {
                    ForEach(items.prefix(limit)) { item in
                        Button {
                            Task { await open(item) }
                        } label: {
                            row(item)
                        }
                        .buttonStyle(.plain)
                        .disabled(openingID != nil || busyIds.contains(item.id))
                        .bookCardContextMenu(
                            items: menuItems(for: item),
                            onAction: { handleMenu($0, item: item) }
                        )
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func row(_ item: ContinueItem) -> some View {
        let opening = openingID == item.id || busyIds.contains(item.id)
        return HStack(spacing: 10) {
            poster(item)
            VStack(alignment: .leading, spacing: 3) {
                Text(title(item))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle(item))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                Text(progressLabel(item))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if opening {
                ProgressView().tint(Theme.muted)
            } else {
                Image(systemName: "arrow.right.circle")
                    .foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Theme.base.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func poster(_ item: ContinueItem) -> some View {
        Rectangle()
            .fill(Theme.base.opacity(0.7))
            .frame(width: 36, height: 54)
            .overlay {
                AsyncImage(url: coverURL(item)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "book")
                        .foregroundStyle(Theme.faint)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: Copy

    private func coverURL(_ item: ContinueItem) -> URL? {
        switch item {
        case let .audiobook(audiobook): audiobook.coverURL
        case let .ebook(ebook): ebook.coverURL
        }
    }

    private func title(_ item: ContinueItem) -> String {
        switch item {
        case let .audiobook(audiobook): audiobook.title
        case let .ebook(ebook): ebook.title
        }
    }

    private func subtitle(_ item: ContinueItem) -> String {
        switch item {
        case let .audiobook(audiobook):
            let author = audiobook.author?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (author?.isEmpty == false) ? "Audiobook · \(author!)" : "Audiobook"
        case let .ebook(ebook):
            let author = ebook.author?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (author?.isEmpty == false) ? "Ebook · \(author!)" : "Ebook"
        }
    }

    private func progressLabel(_ item: ContinueItem) -> String {
        switch item {
        case let .audiobook(audiobook):
            let total = max(audiobook.totalDurationSecs, 1)
            let fraction = min(max(audiobook.positionSecs / total, 0), 1)
            return "\(Formatters.durationClock(audiobook.positionSecs)) / \(Formatters.durationClock(audiobook.totalDurationSecs)) · \(Int(fraction * 100))%"
        case let .ebook(ebook):
            let section = min(max(ebook.spineIndex + 1, 1), max(ebook.spineCount, 1))
            let fraction = Int(min(max(ebook.scrollFraction, 0), 1) * 100)
            return "Section \(section)/\(max(ebook.spineCount, 1)) · \(fraction)%"
        }
    }

    // MARK: Data

    private func load() async {
        guard let client = model.api() else {
            items = []
            errorMessage = nil
            return
        }
        if model.library.isEmpty {
            await model.loadLibrary()
        }
        async let audiobookProgressR = client.getProgress()
        async let ebookProgressR = client.readingProgress()
        let audiobookProgress = try? await audiobookProgressR
        let ebookProgress = try? await ebookProgressR
        items = buildItems(
            audiobookProgress: audiobookProgress ?? [],
            ebookProgress: ebookProgress ?? []
        )
        errorMessage = (audiobookProgress == nil && ebookProgress == nil)
            ? String(localized: "Could not load continue progress.")
            : nil
    }

    private func buildItems(
        audiobookProgress: [RemoteProgress],
        ebookProgress: [ReadingPosition]
    ) -> [ContinueItem] {
        var built: [ContinueItem] = []

        let audiobooksByEdition = Dictionary(
            uniqueKeysWithValues: model.library.compactMap { book -> (Int, BookListItem)? in
                guard let editionId = book.audiobookEditionId else { return nil }
                return (editionId, book)
            }
        )
        for progress in audiobookProgress {
            guard !progress.finished else { continue }
            guard progress.positionSecs > 1, progress.totalDurationSecs > 1 else { continue }
            guard let book = audiobooksByEdition[progress.editionId] else { continue }
            built.append(
                .audiobook(
                    ContinueAudiobookItem(
                        editionId: progress.editionId,
                        title: book.title,
                        author: book.author,
                        coverURL: book.coverURL,
                        positionSecs: progress.positionSecs,
                        totalDurationSecs: progress.totalDurationSecs,
                        updatedAt: progress.updatedAt
                    )
                )
            )
        }

        let ebooksByEdition = Dictionary(
            uniqueKeysWithValues: model.library.compactMap { book -> (Int, BookListItem)? in
                guard let editionId = book.ebookEditionId else { return nil }
                return (editionId, book)
            }
        )
        for progress in ebookProgress {
            guard !progress.finished else { continue }
            guard progress.spineIndex > 0 || progress.scrollFraction > 0.01 else { continue }
            guard let book = ebooksByEdition[progress.editionId] else { continue }
            built.append(
                .ebook(
                    ContinueEbookItem(
                        editionId: progress.editionId,
                        bookId: book.bookId,
                        title: book.title,
                        author: book.author,
                        coverURL: book.coverURL,
                        fileId: progress.fileId,
                        spineIndex: progress.spineIndex,
                        spinePath: progress.spinePath,
                        spineCount: progress.spineCount,
                        scrollFraction: progress.scrollFraction,
                        updatedAt: Date(timeIntervalSince1970: Double(progress.updatedAtMillis) / 1000)
                    )
                )
            )
        }

        return built.sorted { $0.updatedAt > $1.updatedAt }
    }

    private func open(_ item: ContinueItem) async {
        openingID = item.id
        defer { openingID = nil }

        switch item {
        case let .audiobook(audiobook):
            await model.openPlayer(editionId: audiobook.editionId, resumeAt: audiobook.positionSecs)
            if let error = model.errorMessage {
                model.toast(error, style: .error)
            } else {
                showingPlayer = true
            }

        case let .ebook(ebook):
            do {
                previewDocument = try await ebookDocument(for: ebook)
            } catch EbookContinueError.missingRemoteURL {
                model.toast(String(localized: "This server version cannot provide ebook download links yet."), style: .error)
            } catch let error as APIError {
                model.toast(message(for: error), style: .error)
            } catch {
                model.toast(String(localized: "Could not open this ebook yet. Pull to refresh and retry."), style: .error)
            }
        }
    }

    private func ebookDocument(for item: ContinueEbookItem) async throws -> EbookPreviewDocument {
        guard let client = model.api() else { throw APIError.unauthorized }

        let files = try await client.bookEditionFiles(bookId: item.bookId, kind: "ebook")
        guard !files.isEmpty else { throw APIError.http(404) }

        let selected =
            files.first(where: { $0.id == item.fileId })
                ?? files.min(by: { ebookFormatRank($0.format) < ebookFormatRank($1.format) })
                ?? files[0]

        let localURL = try await ensureLocalEbookFile(selected, editionId: item.editionId)
        let language = try? await client.bookDetail(bookId: item.bookId).language
        return EbookPreviewDocument(
            id: selected.id,
            editionId: item.editionId,
            language: language,
            title: item.title,
            localURL: localURL
        )
    }

    private func ensureLocalEbookFile(_ file: BookEditionFile, editionId: Int) async throws -> URL {
        let localURL = FileStore.chapterURL(
            editionId: editionId,
            fileId: file.id,
            ext: ebookExtension(for: file)
        )
        if FileManager.default.fileExists(atPath: localURL.path) {
            return localURL
        }

        guard model.absoluteURL(file.contentUrl) != nil else {
            throw EbookContinueError.missingRemoteURL
        }

        let temporaryURL: URL
        do {
            // NOTE: deliberately surfacing .transport for every failure here to preserve
            // the shipping copy ("Network error…"). The 401→"Sign in required." wording
            // improvement is deferred to the localization phase — see the milestone spec.
            guard let client = model.api() else { throw APIError.unauthorized }
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

    private func ebookExtension(for file: BookEditionFile) -> String {
        let ext = URL(fileURLWithPath: file.fileName).pathExtension.lowercased()
        if !ext.isEmpty {
            return ext
        }
        let normalized = file.format.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        return normalized.isEmpty ? "epub" : normalized
    }

    private func ebookFormatRank(_ format: String) -> Int {
        switch format.lowercased() {
        case "epub": 0
        case "azw3": 1
        case "mobi": 2
        case "pdf": 3
        case "cbz": 4
        default: 99
        }
    }

    private func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            String(localized: "Sign in required.")
        case .forbidden:
            String(localized: "You don't have permission to do that.")
        case let .http(status):
            status == 404
                ? String(localized: "No ebook files are available yet for this book.")
                : String(localized: "Couldn't reach the server (\(status)).")
        case let .server(_, message):
            message
        case .decode:
            String(localized: "Could not parse server response.")
        case .transport:
            String(localized: "Network error. Check your connection.")
        }
    }

    private func libraryBook(for item: ContinueItem) -> BookListItem? {
        switch item {
        case let .audiobook(audiobook):
            model.library.first { $0.audiobookEditionId == audiobook.editionId }
        case let .ebook(ebook):
            model.library.first { $0.bookId == ebook.bookId }
        }
    }

    private func menuItems(for item: ContinueItem) -> [BookCardMenuAction] {
        guard let book = libraryBook(for: item) else { return [] }
        return bookCardMenuItems(
            hasAudiobook: book.hasAudiobook,
            hasEbook: book.hasEbook,
            isAdmin: model.isAdmin
        )
    }

    private func handleMenu(_ action: BookCardMenuAction, item: ContinueItem) {
        guard let book = libraryBook(for: item) else { return }
        switch action {
        case .read:
            if case .ebook = item {
                Task { await open(item) }
            } else {
                readingBook = book
            }
        case .play:
            if case .audiobook = item {
                Task { await open(item) }
            } else if let editionId = book.audiobookEditionId {
                guard !busyIds.contains(item.id) else { return }
                busyIds.insert(item.id)
                Task {
                    await model.openPlayer(editionId: editionId)
                    if model.errorMessage == nil {
                        showingPlayer = true
                    } else {
                        model.toast(model.errorMessage ?? String(localized: "Could not start playback."), style: .error)
                    }
                    busyIds.remove(item.id)
                }
            }
        case .addAudiobook:
            guard !busyIds.contains(item.id) else { return }
            busyIds.insert(item.id)
            Task {
                await addEdition(book: book, kind: "audiobook")
                busyIds.remove(item.id)
            }
        case .addEbook:
            guard !busyIds.contains(item.id) else { return }
            busyIds.insert(item.id)
            Task {
                await addEdition(book: book, kind: "ebook")
                busyIds.remove(item.id)
            }
        case .rescan:
            guard !busyIds.contains(item.id) else { return }
            busyIds.insert(item.id)
            Task {
                await rescanBook(book)
                busyIds.remove(item.id)
            }
        }
    }

    private func addEdition(book: BookListItem, kind: String) async {
        guard let client = model.api() else { return }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
            await load()
            model.toast(String(localized: "Added \(kind == "audiobook" ? "audiobook" : "ebook") edition."), style: .success)
        } catch let error as APIError {
            model.toast(message(for: error), style: .error)
        } catch {
            model.toast(String(localized: "Could not add that edition."), style: .error)
        }
    }

    private func rescanBook(_ book: BookListItem) async {
        guard let client = model.api() else { return }
        do {
            if book.hasAudiobook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "audiobook")
            }
            if book.hasEbook {
                _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "ebook")
            }
            await model.loadLibrary()
            await load()
            model.toast(String(localized: "Rescan started."), style: .success)
        } catch let error as APIError {
            model.toast(message(for: error), style: .error)
        } catch {
            model.toast(String(localized: "Could not rescan this book."), style: .error)
        }
    }

    private enum EbookContinueError: Error {
        case missingRemoteURL
    }

    private struct ContinueAudiobookItem: Identifiable {
        let editionId: Int
        let title: String
        let author: String?
        let coverURL: URL?
        let positionSecs: Double
        let totalDurationSecs: Double
        let updatedAt: Date
        var id: String {
            "audiobook-\(editionId)"
        }
    }

    private struct ContinueEbookItem: Identifiable {
        let editionId: Int
        let bookId: Int
        let title: String
        let author: String?
        let coverURL: URL?
        let fileId: Int?
        let spineIndex: Int
        let spinePath: String
        let spineCount: Int
        let scrollFraction: Double
        let updatedAt: Date
        var id: String {
            "ebook-\(editionId)"
        }
    }

    private enum ContinueItem: Identifiable {
        case audiobook(ContinueAudiobookItem)
        case ebook(ContinueEbookItem)

        var id: String {
            switch self {
            case let .audiobook(audiobook): audiobook.id
            case let .ebook(ebook): ebook.id
            }
        }

        var updatedAt: Date {
            switch self {
            case let .audiobook(audiobook): audiobook.updatedAt
            case let .ebook(ebook): ebook.updatedAt
            }
        }
    }
}
