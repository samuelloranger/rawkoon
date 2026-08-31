import RawkoonKit
import SwiftUI

/// The home screen — recreates the web homepage: greeting, Recently Added and
/// Upcoming rails, then a widget stack (Continue, Now Watching, Downloads,
/// Library Attention, RSS status). Widgets self-hide when their integration is
/// off.
struct HomeView: View {
    @EnvironmentObject private var model: AppModel

    @State private var recent: [LibraryMedia] = []
    @State private var upcoming: [UpcomingItem] = []
    @State private var continueItems: [ContinueItem] = []
    @State private var nowPlaying: NowPlayingResponse?
    @State private var speed: SpeedResponse?
    @State private var attention: [AttentionItem] = []
    @State private var rss: RssStatusResponse?
    @State private var continueError: String?
    @State private var openingContinueID: String?
    @State private var showingPlayer = false
    @State private var previewDocument: EbookPreviewDocument?
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                greeting

                if loading && recent.isEmpty {
                    ProgressView().tint(Theme.apricot)
                        .frame(maxWidth: .infinity).padding(.top, 40)
                } else {
                    if !recent.isEmpty { rail("Recently added", recent.map(RailItem.library)) }
                    if !upcoming.isEmpty { rail("Upcoming", upcoming.map(RailItem.upcoming)) }
                    widgets
                }
            }
            .padding(.vertical, 12)
            .padding(.bottom, 96)
        }
        .background(Theme.base)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Image("AppLogo")
                        .resizable()
                        .frame(width: 24, height: 24)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text("Rawkoon")
                        .font(.display(20))
                        .foregroundStyle(Theme.textStrong)
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingPlayer, onDismiss: {
            Task { await load() }
        }) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environmentObject(model)
            }
        }
        .sheet(item: $previewDocument, onDismiss: {
            Task { await load() }
        }) { document in
            EbookReaderSheet(document: document)
                .environmentObject(model)
        }
    }

    // MARK: Greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(timeGreeting), \(model.userFirstName ?? "there")")
                .font(.display(28))
                .foregroundStyle(Theme.textStrong)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
    }

    private var timeGreeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12: return "Good morning"
        case 12..<18: return "Good afternoon"
        default: return "Good evening"
        }
    }

    private var subtitle: String {
        let weekday = Calendar.current.component(.weekday, from: Date())
        switch weekday {
        case 1, 7: return "Enjoy your weekend."
        case 2: return "A fresh week begins."
        case 6: return "The weekend's nearly here."
        default: return "Here's what's happening."
        }
    }

    // MARK: Poster rails

    private enum RailItem: Identifiable {
        case library(LibraryMedia)
        case upcoming(UpcomingItem)
        var id: String {
            switch self {
            case .library(let m): return "l\(m.id)"
            case .upcoming(let u): return "u\(u.id)"
            }
        }
    }

    private func rail(_ title: String, _ items: [RailItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.display(19)).foregroundStyle(Theme.textStrong).padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in railCard(item) }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    @ViewBuilder
    private func railCard(_ item: RailItem) -> some View {
        switch item {
        case .library(let m):
            NavigationLink {
                MediaDetailView(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie",
                                title: m.title, posterPath: m.posterUrl, libraryId: m.id)
            } label: { poster(title: m.title, url: m.posterUrl) }
            .buttonStyle(.plain)
        case .upcoming(let u):
            NavigationLink {
                MediaDetailView(tmdbId: u.tmdbId ?? 0, mediaType: u.mediaType,
                                title: u.title, posterPath: u.posterUrl, libraryId: u.libraryId)
            } label: { poster(title: u.title, url: u.posterUrl) }
            .buttonStyle(.plain)
            .disabled(u.tmdbId == nil && u.libraryId == nil)
        }
    }

    private func poster(title: String, url: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Rectangle().fill(Theme.raised)
                .frame(width: 110, height: 165)
                .overlay {
                    AsyncImage(url: model.absoluteURL(url)) { $0.resizable().scaledToFill() }
                        placeholder: { Image(systemName: "photo").foregroundStyle(Theme.faint) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.05), lineWidth: 1))
            Text(title).font(.display(13)).foregroundStyle(Theme.textStrong)
                .lineLimit(2).frame(width: 110, height: 34, alignment: .top)
        }
    }

    // MARK: Widgets

    private struct ContinueAudiobookItem: Identifiable {
        let editionId: Int
        let title: String
        let author: String?
        let coverURL: URL?
        let positionSecs: Double
        let totalDurationSecs: Double
        let updatedAt: Date

        var id: String { "audiobook-\(editionId)" }
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

        var id: String { "ebook-\(editionId)" }
    }

    private enum ContinueItem: Identifiable {
        case audiobook(ContinueAudiobookItem)
        case ebook(ContinueEbookItem)

        var id: String {
            switch self {
            case .audiobook(let audiobook): return audiobook.id
            case .ebook(let ebook): return ebook.id
            }
        }

        var updatedAt: Date {
            switch self {
            case .audiobook(let audiobook): return audiobook.updatedAt
            case .ebook(let ebook): return ebook.updatedAt
            }
        }
    }

    private var widgets: some View {
        VStack(spacing: 14) {
            if !continueItems.isEmpty || continueError != nil { continueWidget }
            if let np = nowPlaying, np.enabled { nowWatchingWidget(np) }
            downloadsWidget
            if !attention.isEmpty { attentionWidget }
            if let rss { rssWidget(rss) }
        }
        .padding(.horizontal, 16)
    }

    private var continueWidget: some View {
        widgetCard("Continue", systemImage: "bookmark") {
            if let continueError, continueItems.isEmpty {
                Text(continueError)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else if continueItems.isEmpty {
                Text("Start an audiobook or EPUB and it'll appear here.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 10) {
                    ForEach(continueItems.prefix(6)) { item in
                        Button {
                            Task { await openContinue(item) }
                        } label: {
                            continueRow(item)
                        }
                        .buttonStyle(.plain)
                        .disabled(openingContinueID != nil)
                    }
                }
            }
        }
    }

    private func continueRow(_ item: ContinueItem) -> some View {
        let opening = openingContinueID == item.id
        return HStack(spacing: 10) {
            continuePoster(item)

            VStack(alignment: .leading, spacing: 3) {
                Text(continueTitle(item))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(continueSubtitle(item))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                Text(continueProgressLabel(item))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if opening {
                ProgressView().tint(Theme.apricot)
            } else {
                Image(systemName: "arrow.right.circle.fill")
                    .foregroundStyle(Theme.apricot)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Theme.base.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
    }

    private func continueCoverURL(_ item: ContinueItem) -> URL? {
        switch item {
        case let .audiobook(audiobook): return audiobook.coverURL
        case let .ebook(ebook): return ebook.coverURL
        }
    }

    // Not a `let` + `switch` inside the @ViewBuilder body: the builder reads a
    // switch as a view expression, and one that assigns produces `()`.
    private func continuePoster(_ item: ContinueItem) -> some View {
        let coverURL = continueCoverURL(item)

        return Rectangle()
            .fill(Theme.base.opacity(0.7))
            .frame(width: 36, height: 54)
            .overlay {
                AsyncImage(url: coverURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "book")
                        .foregroundStyle(Theme.faint)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )
    }

    private func continueTitle(_ item: ContinueItem) -> String {
        switch item {
        case .audiobook(let audiobook):
            return audiobook.title
        case .ebook(let ebook):
            return ebook.title
        }
    }

    private func continueSubtitle(_ item: ContinueItem) -> String {
        switch item {
        case .audiobook(let audiobook):
            let author = audiobook.author?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (author?.isEmpty == false) ? "Audiobook · \(author!)" : "Audiobook"
        case .ebook(let ebook):
            let author = ebook.author?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (author?.isEmpty == false) ? "EPUB · \(author!)" : "EPUB"
        }
    }

    private func continueProgressLabel(_ item: ContinueItem) -> String {
        switch item {
        case .audiobook(let audiobook):
            let total = max(audiobook.totalDurationSecs, 1)
            let fraction = min(max(audiobook.positionSecs / total, 0), 1)
            return "\(formatDuration(audiobook.positionSecs)) / \(formatDuration(audiobook.totalDurationSecs)) · \(Int(fraction * 100))%"
        case .ebook(let ebook):
            let page = min(max(ebook.spineIndex + 1, 1), max(ebook.spineCount, 1))
            let fraction = Int(min(max(ebook.scrollFraction, 0), 1) * 100)
            return "Page \(page)/\(max(ebook.spineCount, 1)) · \(fraction)%"
        }
    }

    private func widgetCard<C: View>(_ title: String, systemImage: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.display(16)).foregroundStyle(Theme.textStrong)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func nowWatchingWidget(_ np: NowPlayingResponse) -> some View {
        widgetCard("Now watching", systemImage: "play.tv") {
            if let sessions = np.sessions, !sessions.isEmpty {
                VStack(spacing: 10) {
                    ForEach(sessions) { s in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.title ?? "Playing").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text).lineLimit(1)
                                Text("\(s.user ?? "") · \(s.device ?? "")").font(.caption2).foregroundStyle(Theme.faint).lineLimit(1)
                            }
                            Spacer()
                            if let p = s.progressPct {
                                Text("\(Int(p))%").font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.apricot)
                            }
                        }
                    }
                }
            } else {
                Text("Nobody's watching right now.").font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    private var downloadsWidget: some View {
        widgetCard("Downloads", systemImage: "arrow.down.circle") {
            if let speed, speed.connected {
                HStack(spacing: 18) {
                    speedLabel("down", speed.dlSpeed, Theme.apricotSoft)
                    speedLabel("up", speed.ulSpeed, Theme.seed)
                }
            } else {
                Text(speed?.enabled == true ? "Download client offline." : "No download client configured.")
                    .font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    private func speedLabel(_ dir: String, _ bytes: Double, _ tint: Color) -> some View {
        let text = bytes <= 0 ? "0 KB/s"
            : "\(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file))/s"
        return HStack(spacing: 5) {
            Image(systemName: dir == "down" ? "arrow.down" : "arrow.up").font(.caption2).foregroundStyle(tint)
            Text(text).font(.system(.subheadline, design: .monospaced)).foregroundStyle(Theme.text)
        }
    }

    private var attentionWidget: some View {
        widgetCard("Needs attention", systemImage: "exclamationmark.triangle") {
            VStack(spacing: 10) {
                ForEach(attention.prefix(5)) { item in
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(Theme.terracotta).frame(width: 7, height: 7).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.mediaTitle ?? item.kind ?? "Item").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text).lineLimit(1)
                            if let detail = item.detail {
                                Text(detail).font(.caption2).foregroundStyle(Theme.muted).lineLimit(2)
                            }
                        }
                        Spacer()
                    }
                }
            }
        }
    }

    private func rssWidget(_ r: RssStatusResponse) -> some View {
        widgetCard("RSS", systemImage: "dot.radiowaves.up.forward") {
            if let run = r.lastRun {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        StatusBadge(text: run.status == "error" ? "Error" : "OK",
                                    tint: run.status == "error" ? Theme.terracotta : Theme.seed)
                        Text("\(run.releasesFound ?? 0) found · \(run.releasesGrabbed ?? 0) grabbed")
                            .font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.muted)
                    }
                    if let err = run.error {
                        Text(err).font(.caption2).foregroundStyle(Theme.terracotta).lineLimit(1)
                    }
                }
            } else {
                Text("No RSS runs yet.").font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    // MARK: Load

    private func load() async {
        guard let client = model.api() else {
            loading = false
            continueItems = []
            continueError = nil
            return
        }
        if model.library.isEmpty {
            await model.loadLibrary()
        }
        async let recentR = client.recentlyAdded()
        async let upcomingR = client.upcoming()
        async let npR = client.nowPlaying()
        async let speedR = client.speed()
        async let attnR = client.libraryAttention()
        async let rssR = client.rssStatus()
        async let audiobookProgressR = client.getProgress()
        async let ebookProgressR = client.readingProgress()

        recent = (try? await recentR)?.items ?? []
        upcoming = (try? await upcomingR)?.items ?? []
        nowPlaying = try? await npR
        speed = try? await speedR
        attention = (try? await attnR)?.items ?? []
        rss = try? await rssR

        let audiobookProgress = try? await audiobookProgressR
        let ebookProgress = try? await ebookProgressR
        continueItems = buildContinueItems(
            audiobookProgress: audiobookProgress ?? [],
            ebookProgress: ebookProgress ?? []
        )
        continueError = (audiobookProgress == nil && ebookProgress == nil)
            ? "Could not load continue progress."
            : nil

        loading = false
    }

    private func buildContinueItems(
        audiobookProgress: [RemoteProgress],
        ebookProgress: [ReadingPosition]
    ) -> [ContinueItem] {
        var items: [ContinueItem] = []

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

            items.append(
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

            items.append(
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

        return items
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    private func openContinue(_ item: ContinueItem) async {
        openingContinueID = item.id
        defer { openingContinueID = nil }

        switch item {
        case .audiobook(let audiobook):
            continueError = nil
            await model.openPlayer(editionId: audiobook.editionId, resumeAt: audiobook.positionSecs)
            if let error = model.errorMessage {
                continueError = error
            } else {
                showingPlayer = true
            }

        case .ebook(let ebook):
            do {
                previewDocument = try await continueEbookDocument(for: ebook)
                continueError = nil
            } catch EbookContinueError.missingRemoteURL {
                continueError = "This server version cannot provide ebook download links yet."
            } catch let error as APIError {
                continueError = message(for: error)
            } catch {
                continueError = "Could not open this EPUB yet. Pull to refresh and retry."
            }
        }
    }

    private func continueEbookDocument(for item: ContinueEbookItem) async throws -> EbookPreviewDocument {
        guard let client = model.api() else { throw APIError.unauthorized }

        let files = try await client.bookEditionFiles(bookId: item.bookId, kind: "ebook")
        guard !files.isEmpty else { throw APIError.http(404) }

        let selected =
            files.first(where: { $0.id == item.fileId })
            ?? files.min(by: { ebookFormatRank($0.format) < ebookFormatRank($1.format) })
            ?? files[0]

        let localURL = try await ensureLocalEbookFile(selected, editionId: item.editionId)
        return EbookPreviewDocument(
            id: selected.id,
            editionId: item.editionId,
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

        guard let remoteURL = model.absoluteURL(file.contentUrl) else {
            throw EbookContinueError.missingRemoteURL
        }

        let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
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
        case "epub": return 0
        case "azw3": return 1
        case "mobi": return 2
        case "pdf": return 3
        case "cbz": return 4
        default: return 99
        }
    }

    private func formatDuration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 { return "\(hours)h \(String(format: "%02dm", minutes))" }
        return "\(minutes)m"
    }

    private func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            return "Sign in required."
        case let .http(status):
            return status == 404
                ? "No EPUB files are available yet for this book."
                : "Server error (\(status))."
        case .decode:
            return "Could not parse server response."
        case .transport:
            return "Network error. Check your connection."
        }
    }

    private enum EbookContinueError: Error {
        case missingRemoteURL
    }
}
