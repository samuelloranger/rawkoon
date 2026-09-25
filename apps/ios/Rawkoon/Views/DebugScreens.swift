#if DEBUG
    import RawkoonKit
    import SwiftUI

    /// Debug-only screenshot harness. When `RAWKOON_SCREEN` is set in the launch
    /// environment, the app renders that screen in isolation (after autologin)
    /// instead of the tab bar, so pushed/sheet screens can be captured on the
    /// simulator without tap injection. Compiled out of Release/TestFlight builds.
    enum DebugScreen {
        static var requested: String? {
            ProcessInfo.processInfo.environment["RAWKOON_SCREEN"]
        }

        /// Screens that need no server, so they render BEFORE the login gate.
        ///
        /// The rest of the harness lives inside `RootTabsView` and therefore only
        /// exists once autologin has succeeded, which needs credentials in the
        /// launch environment. A screen driven entirely by synthetic data should not
        /// need any of that to be screenshotted.
        @ViewBuilder
        static func offlineView(for screen: String) -> some View {
            switch screen {
            case "player":
                DebugPlayer(chapterCount: 63, resumeAt: 15120)
            case "playerNoChapters":
                DebugPlayer(chapterCount: 0, resumeAt: 15120)
            case "deck":
                DebugDeck()
            case "tabBar":
                DebugTabBarStates()
            case "tabContainer":
                DebugTabContainer()
            case "orderedSources":
                DebugOrderedSources()
            case "bookDiscoveryDetail":
                NavigationStack {
                    DiscoveryBookDetailView(book: BookDiscoveryBook(
                        rank: 1,
                        title: "C'était ça ou mourir",
                        isbn13: "9782764629253",
                        coverUrl: "https://images.leslibraires.ca/books/9782764629253/front/9782764629253_large.webp",
                        sourceUrl: "https://www.leslibraires.ca/livres/c-etait-ca-ou-mourir-9782764629253",
                        author: "Thélyson Orélien",
                        overview: """
                        Quand mon quartier a brûlé, j'ai ri comme un idiot. Devant l'horreur, \
                        plutôt que de pleurer, Jonas Dorléon choisit de rire. Rire et marcher. \
                        Prof d'histoire et de géographie à Carrefour-Feuilles, un quartier \
                        densément peuplé de Port-au-Prince, Jonas est contraint de quitter sa maison.
                        """,
                        publishedYear: 2026,
                        volumeId: nil,
                        alreadyInLibrary: false
                    ))
                }
            default:
                EmptyView()
            }
        }

        static func isOffline(_ screen: String) -> Bool {
            [
                "player", "playerNoChapters", "deck", "orderedSources",
                "bookDiscoveryDetail", "tabBar", "tabContainer",
            ].contains(screen)
        }
    }

    /// Renders the ranked source list against synthetic data — no server, no
    /// credentials. The ordering UI is the whole point of the screen, so a seeded
    /// selection is enough to review it.
    struct DebugOrderedSources: View {
        @State private var sources = ["BluRay", "WEB-DL", "HDTV"]

        var body: some View {
            NavigationStack {
                OrderedMultiSelectList(
                    titleKey: "Preferred sources",
                    selected: $sources,
                    options: QualityProfileSources.options.map { ($0.value, Text($0.label)) }
                )
            }
        }
    }

    /// Loads the first library item of a type and shows its detail — avoids having
    /// to know real tmdb/library ids for a screenshot.
    struct DebugFirstDetail: View {
        @Environment(AppModel.self) private var model
        let libraryType: String // "movie" | "show"

        @State private var media: LibraryMedia?
        @State private var failed = false

        var body: some View {
            NavigationStack {
                Group {
                    if let media {
                        MediaDetailView(
                            tmdbId: media.tmdbId,
                            mediaType: libraryType == "show" ? "tv" : "movie",
                            title: media.title,
                            posterPath: media.posterUrl,
                            libraryId: media.id,
                            focusManagement: ProcessInfo.processInfo.environment["RAWKOON_FOCUS_MANAGEMENT"] != nil
                        )
                    } else if failed {
                        Text("No \(libraryType) in library").foregroundStyle(Theme.muted)
                    } else {
                        ProgressView().tint(Theme.apricot)
                    }
                }
                .background(Theme.base)
            }
            .task { await load() }
        }

        private func load() async {
            guard let client = model.api() else { return }
            media = try? await client.libraryList(type: libraryType).items.first
            if media == nil {
                failed = true
            }
        }
    }

    /// Shows a book's detail — prefers an ebook-only book so the merged view and
    /// the "Add audiobook" flow are visible.
    struct DebugFirstBook: View {
        @Environment(AppModel.self) private var model
        @State private var loaded = false

        var body: some View {
            NavigationStack {
                Group {
                    if let book = pick() {
                        BookView(book: book)
                            .id(book.bookId)
                    } else if loaded {
                        Text("No books").foregroundStyle(Theme.muted)
                    } else {
                        ProgressView().tint(Theme.apricot)
                    }
                }
                .background(Theme.base)
            }
            .task {
                if model.library.isEmpty {
                    await model.loadLibrary()
                }
                loaded = true
            }
        }

        private func pick() -> BookListItem? {
            if let raw = ProcessInfo.processInfo.environment["RAWKOON_BOOK"],
               let id = Int(raw)
            {
                return model.library.first { $0.bookId == id }
            }
            return model.library.first { $0.hasEbook && !$0.hasAudiobook } ?? model.library.first
        }
    }

    /// Shows the release-search sheet content for the first library movie.
    struct DebugFirstReleaseSearch: View {
        @Environment(AppModel.self) private var model

        @State private var media: LibraryMedia?
        @State private var failed = false

        var body: some View {
            Group {
                if let media {
                    ReleaseSearchView(
                        query: media.title,
                        libraryMediaId: media.id,
                        tmdbId: media.tmdbId,
                        mediaType: "movie"
                    )
                } else if failed {
                    Text("No movie in library").foregroundStyle(Theme.muted)
                } else {
                    ProgressView().tint(Theme.apricot)
                }
            }
            .background(Theme.base)
            .task {
                guard let client = model.api() else { return }
                media = try? await client.libraryList(type: "movie").items.first
                if media == nil {
                    failed = true
                }
            }
        }
    }

    /// Wraps the real tab bar and opens the first audiobook, so the mini player
    /// can be screenshotted without tap injection — `simctl` cannot tap, and the
    /// bar only appears once a book is loaded.
    struct DebugMiniPlayer<Content: View>: View {
        @Environment(AppModel.self) private var model
        @ViewBuilder let content: () -> Content

        var body: some View {
            content()
                .task {
                    if model.library.isEmpty {
                        await model.loadLibrary()
                    }
                    guard
                        model.activeEditionId == nil,
                        let editionId = model.library.first(where: { $0.hasAudiobook })?.audiobookEditionId
                    else { return }
                    await model.openPlayer(editionId: editionId)
                }
        }
    }

    /// Renders `PlayerView` against a synthetic manifest, so the scrubber can be
    /// screenshotted on the simulator with no server, no credentials and no real
    /// audio. The chapter shape is what decides which scrubber branch renders, and
    /// that is exactly what needs reviewing.
    ///
    /// `RAWKOON_SCREEN=player` — 63 chapters resumed mid-book: the chapter-scoped
    /// scrubber. `RAWKOON_SCREEN=playerNoChapters` — no chapter timeline at all,
    /// which is the shape a single-file m4b edition has and the whole-book fallback
    /// it must take.
    struct DebugPlayer: View {
        @Environment(AppModel.self) private var model
        /// Zero means "no chapter timeline", which is the fallback case.
        let chapterCount: Int
        let resumeAt: Double

        @State private var manifest: BookManifest?

        private static let chapterSecs: Double = 552 // the real library's mean

        var body: some View {
            Group {
                if let manifest {
                    PlayerView(summary: summary(for: manifest), manifest: manifest)
                } else {
                    ProgressView().tint(Theme.apricot)
                }
            }
            .background(Theme.base)
            .task { load() }
        }

        private func summary(for manifest: BookManifest) -> LibrarySummary {
            LibrarySummary(
                editionId: manifest.editionId,
                bookId: manifest.bookId,
                title: manifest.title,
                author: manifest.authors.first,
                coverURL: nil,
                durationSecs: manifest.totalDurationSecs
            )
        }

        private func load() {
            guard manifest == nil else { return }
            guard let decoded = Self.syntheticManifest(chapterCount: chapterCount) else { return }
            manifest = decoded
            // Any resolvable host will do: the queue only needs URLs it can build
            // AVPlayerItems from, and nothing is ever played here.
            guard let baseURL = URL(string: "https://screenshot.invalid") else { return }
            model.player.load(manifest: decoded, baseURL: baseURL, resumeAt: resumeAt)
        }

        /// Built as JSON and decoded, because RawkoonKit exposes no public
        /// initialiser for these types.
        fileprivate static func syntheticManifest(chapterCount: Int) -> BookManifest? {
            var chapters: [String] = []
            for index in 0 ..< chapterCount {
                let start = Double(index) * chapterSecs
                let title = index == 0 ? "Prologue"
                    : index == chapterCount - 1 ? "Epilogue"
                    : "Chapitre \(index)"
                chapters.append("""
                {"index":\(index),"title":"\(title)","start_secs":\(start),\
                "end_secs":\(start + chapterSecs),"file_id":\(1000 + index),\
                "size_bytes":5000000,"sha256":null,\
                "url":"/api/books/files/\(1000 + index)/content.mp3?grant=debug"}
                """)
            }
            let total = chapterCount > 0 ? Double(chapterCount) * chapterSecs : 34748
            let json = """
            {"edition_id":63,"book_id":9,"title":"La femme de ménage",\
            "authors":["Freida McFadden"],"total_duration_secs":\(total),\
            "chapters":[\(chapters.joined(separator: ","))]}
            """
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try? decoder.decode(BookManifest.self, from: Data(json.utf8))
        }
    }

    /// `RAWKOON_SCREEN=deck` — the discover triage deck (Task 3, "Dusk in
    /// Motion") with three synthetic items, screenshotted with no server. Also
    /// the place to toggle Simulator Settings > Accessibility > Motion >
    /// Reduce Motion and re-screenshot to confirm the drag-follow disables.
    struct DebugDeck: View {
        private static let sample: [DiscoverDeckItem] = [
            DiscoverDeckItem(
                id: "movie-1", tmdbId: 1, mediaType: "movie", title: "Dusk in Motion",
                releaseYear: 2024, posterUrl: nil, overview: nil, voteAverage: 7.8, genreIds: []
            ),
            DiscoverDeckItem(
                id: "tv-2", tmdbId: 2, mediaType: "tv", title: "The Long Corridor",
                releaseYear: 2022, posterUrl: nil, overview: nil, voteAverage: 8.4, genreIds: []
            ),
            DiscoverDeckItem(
                id: "movie-3", tmdbId: 3, mediaType: "movie", title: "Amber Hour",
                releaseYear: 2019, posterUrl: nil, overview: nil, voteAverage: nil, genreIds: []
            ),
        ]

        var body: some View {
            ZStack {
                Theme.base.ignoresSafeArea()
                SwipeDeck(
                    items: Self.sample, label: "For you", primaryActionTitle: "Add",
                    onDismiss: { _ in }, onWatchlist: { _ in }, onPrimary: { _ in },
                    onExhausted: {}, onOpen: { _ in }
                )
            }
        }
    }

    /// Opens `PlayerView` on a REAL edition fetched from the signed-in server, so
    /// the scrubber can be reviewed against a real chapter timeline and real
    /// streaming audio rather than synthetic data.
    ///
    /// `RAWKOON_EDITION` picks the audiobook edition id; without it the first
    /// audiobook in the library is used. `RAWKOON_RESUME` is the whole-book position
    /// in seconds to resume at, so a screenshot can be taken mid-chapter rather than
    /// at a chapter boundary.
    struct DebugRealPlayer: View {
        @Environment(AppModel.self) private var model

        @State private var loaded: (summary: LibrarySummary, manifest: BookManifest)?
        @State private var failure: String?

        var body: some View {
            Group {
                if let loaded {
                    PlayerView(summary: loaded.summary, manifest: loaded.manifest)
                } else if let failure {
                    Text(failure)
                        .font(.subheadline)
                        .foregroundStyle(Theme.terracotta)
                        .multilineTextAlignment(.center)
                        .padding(24)
                } else {
                    ProgressView().tint(Theme.apricot)
                }
            }
            .background(Theme.base)
            .task { await load() }
        }

        private func load() async {
            guard loaded == nil, failure == nil else { return }
            let env = ProcessInfo.processInfo.environment
            let resumeAt = Double(env["RAWKOON_RESUME"] ?? "") ?? 15120

            if model.library.isEmpty {
                await model.loadLibrary()
            }

            let requested = Int(env["RAWKOON_EDITION"] ?? "")
            let book: BookListItem? = if let requested {
                model.library.first { $0.audiobookEditionId == requested }
            } else {
                model.library.first { $0.hasAudiobook }
            }

            guard let book, let summary = book.audiobookSummary else {
                failure = "No audiobook edition \(requested.map(String.init) ?? "") in the library"
                return
            }

            guard let manifest = try? await model.manifest(summary.editionId) else {
                failure = "Edition \(summary.editionId) has no manifest — it is not offline-ready"
                return
            }

            guard let baseURL = URL(string: model.serverURL) else {
                failure = "Server URL is not usable"
                return
            }

            model.player.load(manifest: manifest, baseURL: baseURL, resumeAt: resumeAt)
            loaded = (summary, manifest)

            // `RAWKOON_JUMP_TO` reproduces a chapter tap taken from an ALREADY
            // LOADED position: load at RAWKOON_RESUME, let the queue settle, then
            // seek. Seeking from a live queue is a different path from building
            // one at a position (`inPlaceSeekOffset` returns nil across a chapter,
            // so `buildQueue` runs against an existing player), and it is the path
            // a chapter tap actually takes.
            if let jumpRaw = env["RAWKOON_JUMP_TO"], let jumpTo = Double(jumpRaw) {
                let settle = UInt64(Double(env["RAWKOON_JUMP_DELAY"] ?? "") ?? 8)
                try? await Task.sleep(nanoseconds: settle * 1_000_000_000)
                Log.playback.error(
                    """
                    DEBUG jump: from=\(model.player.positionSecs, privacy: .public) \
                    to=\(jumpTo, privacy: .public)
                    """
                )
                model.player.seek(to: jumpTo)
                try? await Task.sleep(nanoseconds: 6 * 1_000_000_000)
                Log.playback.error(
                    """
                    DEBUG after jump: position=\(model.player.positionSecs, privacy: .public) \
                    chapterIndex=\(model.player.currentChapterIndex ?? -1, privacy: .public)
                    """
                )
            }
        }
    }

    /// Opens the EPUB reader on a real book from the signed-in server, downloading
    /// the file first if it is not already local.
    ///
    /// `RAWKOON_BOOK` picks the book id; without it the first book with an ebook
    /// edition is used. This is the only way to reach the reader on the simulator
    /// without tap injection, and the reader is the one screen whose output cannot
    /// be judged from a compile.
    struct DebugEbookReader: View {
        @Environment(AppModel.self) private var model

        @State private var document: EbookPreviewDocument?
        @State private var failure: String?

        var body: some View {
            Group {
                if let document {
                    EbookReaderSheet(document: document)
                } else if let failure {
                    Text(failure)
                        .font(.subheadline)
                        .foregroundStyle(Theme.terracotta)
                        .multilineTextAlignment(.center)
                        .padding(24)
                } else {
                    VStack(spacing: 10) {
                        ProgressView().tint(Theme.importing)
                        Text("Fetching the book…")
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
            .background(Theme.base)
            .task { await load() }
        }

        private func load() async {
            guard document == nil, failure == nil else { return }

            // Offline path: with RAWKOON_LOCAL_EDITION and RAWKOON_LOCAL_FILE set,
            // the document is built straight from disk with no API call at all, so a
            // run against an unreachable server proves the reader needs no network.
            let env = ProcessInfo.processInfo.environment
            if
                let editionId = Int(env["RAWKOON_LOCAL_EDITION"] ?? ""),
                let fileId = Int(env["RAWKOON_LOCAL_FILE"] ?? "")
            {
                let localURL = FileStore.chapterURL(editionId: editionId, fileId: fileId, ext: "epub")
                guard FileManager.default.fileExists(atPath: localURL.path) else {
                    failure = "Not downloaded: \(localURL.lastPathComponent)"
                    return
                }
                document = EbookPreviewDocument(
                    id: fileId,
                    editionId: editionId,
                    language: env["RAWKOON_LOCAL_LANGUAGE"],
                    title: "Offline",
                    localURL: localURL
                )
                return
            }

            guard let client = model.api() else { failure = "No API client"; return }

            if model.library.isEmpty {
                await model.loadLibrary()
            }

            let requested = Int(ProcessInfo.processInfo.environment["RAWKOON_BOOK"] ?? "")
            let book: BookListItem? = if let requested {
                model.library.first { $0.bookId == requested }
            } else {
                model.library.first { $0.hasEbook }
            }
            guard let book else {
                failure = "No book \(requested.map(String.init) ?? "with an ebook") in the library"
                return
            }

            guard
                let files = try? await client.bookEditionFiles(bookId: book.bookId, kind: "ebook"),
                let file = files.first(where: { $0.format.lowercased() == "epub" }) ?? files.first
            else {
                failure = "Book \(book.bookId) has no ebook files"
                return
            }

            let editionId = book.ebookEditionId ?? (1_000_000_000 + book.bookId)
            let ext = URL(fileURLWithPath: file.fileName).pathExtension.lowercased()
            let localURL = FileStore.chapterURL(
                editionId: editionId,
                fileId: file.id,
                ext: ext.isEmpty ? "epub" : ext
            )

            if !FileManager.default.fileExists(atPath: localURL.path) {
                guard model.absoluteURL(file.contentUrl) != nil else {
                    failure = "No signed content URL for file \(file.id)"
                    return
                }
                do {
                    let temp = try await client.downloadFile(path: file.contentUrl ?? "")
                    try FileManager.default.createDirectory(
                        at: localURL.deletingLastPathComponent(),
                        withIntermediateDirectories: true
                    )
                    try FileManager.default.moveItem(at: temp, to: localURL)
                } catch {
                    failure = "Download failed: \(error.localizedDescription)"
                    return
                }
            }

            let language = try? await client.bookDetail(bookId: book.bookId).language
            document = EbookPreviewDocument(
                id: file.id,
                editionId: book.ebookEditionId,
                language: language,
                title: book.title,
                localURL: localURL
            )
        }
    }

    /// `RAWKOON_SCREEN=tabContainer`: the real iPhone container over mock lists.
    /// `RAWKOON_TABBAR_BOTTOM=1` starts the list at its end, which collapses the
    /// bar through the real scroll path and shows whether the last row clears it.
    /// `RAWKOON_TABBAR_PLAYING=1` loads a synthetic audiobook so the mini player shows.
    /// `RAWKOON_TABBAR_DEMO=1` switches tabs, then scrolls down and back up, for a
    /// screen recording of the transitions.
    private struct DebugTabContainer: View {
        @Environment(AppModel.self) private var model
        @State private var selection = RootTab.books
        @State private var demoScrollTarget: Int?
        private let atBottom = ProcessInfo.processInfo.environment["RAWKOON_TABBAR_BOTTOM"] != nil
        private let playing = ProcessInfo.processInfo.environment["RAWKOON_TABBAR_PLAYING"] != nil
        private let demo = ProcessInfo.processInfo.environment["RAWKOON_TABBAR_DEMO"] != nil

        var body: some View {
            // Rendered once the synthetic book is active, so the list anchors with the final inset.
            Group {
                if !playing || model.activeEditionId != nil {
                    container
                } else {
                    Theme.base
                }
            }
            .onAppear(perform: loadPlayingBook)
            .task { await runDemo() }
        }

        private func runDemo() async {
            guard demo else { return }
            let pause = Duration.milliseconds(1400)
            try? await Task.sleep(for: .seconds(2))
            for tab in [RootTab.home, .settings, .books] {
                withAnimation(.spring(duration: 0.35, bounce: 0.2)) { selection = tab }
                try? await Task.sleep(for: pause)
            }
            for row in [40, 1, 40, 1] {
                demoScrollTarget = row
                try? await Task.sleep(for: pause)
            }
        }

        private var container: some View {
            PhoneTabsView(selection: $selection, onExpandPlayer: {}) { tab in
                NavigationStack {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 10) {
                                ForEach(1 ... 40, id: \.self) { row in
                                    Text(verbatim: "Row \(row)")
                                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                                        .padding(.horizontal, 14)
                                        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.raised))
                                        .id(row)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                        .reportsTabBarScroll()
                        .background(Theme.base)
                        .navigationTitle(Text(tab.title))
                        // Scrolled after layout, the way a user lands at the end.
                        .task {
                            guard atBottom else { return }
                            try? await Task.sleep(for: .milliseconds(500))
                            withAnimation { proxy.scrollTo(40, anchor: .bottom) }
                        }
                        .onChange(of: demoScrollTarget) { _, row in
                            guard let row, tab == selection else { return }
                            withAnimation(.easeInOut(duration: 0.8)) {
                                proxy.scrollTo(row, anchor: row == 1 ? .top : .bottom)
                            }
                        }
                    }
                }
            }
        }

        private func loadPlayingBook() {
            guard playing, model.activeEditionId == nil,
                  let manifest = DebugPlayer.syntheticManifest(chapterCount: 12),
                  let baseURL = URL(string: "https://screenshot.invalid")
            else { return }
            model.library = [BookListItem(
                bookId: manifest.bookId, title: manifest.title, author: manifest.authors.first,
                coverURL: nil, audiobookEditionId: manifest.editionId, ebookEditionId: nil,
                audiobookDurationSecs: manifest.totalDurationSecs, audiobookStatus: "downloaded",
                audiobookFileCount: manifest.files.count, hasEbook: false, readAt: nil
            )]
            model.manifests[manifest.editionId] = manifest
            model.activeEditionId = manifest.editionId
            model.player.load(manifest: manifest, baseURL: baseURL, resumeAt: 1800)
        }
    }

    /// `RAWKOON_SCREEN=tabBar`: the custom bar's states for screenshot review.
    private struct DebugTabBarStates: View {
        @State private var home = RootTab.home
        @State private var books = RootTab.books

        var body: some View {
            VStack(spacing: 28) {
                Spacer()
                RawkoonTabBar(tabs: RootTab.phone, selection: $home, isCollapsed: false,
                              unreadLabel: "3", initials: "SL", onExpand: {})
                RawkoonTabBar(tabs: RootTab.phone, selection: $books, isCollapsed: false,
                              unreadLabel: "9+", initials: nil, onExpand: {})
                HStack {
                    RawkoonTabBar(tabs: RootTab.phone, selection: $books, isCollapsed: true,
                                  unreadLabel: nil, initials: "SL", onExpand: {})
                        .fixedSize()
                    Spacer()
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.base)
        }
    }
#endif
