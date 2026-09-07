import RawkoonKit
import SwiftUI

private enum LibrarySection: String, CaseIterable, Identifiable {
    case media = "Media"
    case books = "Books"
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .media: "Media"
        case .books: "Books"
        }
    }
}

/// Defaults mirror the web app: type=all, status=all, sort=added_at desc.
private enum MediaTypeFilter: String, CaseIterable, Identifiable {
    case all, movie, show
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .movie: "Movies"
        case .show: "Shows"
        }
    }

    var param: String? {
        self == .all ? nil : rawValue
    }
}

private enum MediaStatusFilter: String, CaseIterable, Identifiable {
    case all, downloaded, wanted, downloading
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .downloaded: "Downloaded"
        case .wanted: "Missing"
        case .downloading: "Downloading"
        }
    }

    var param: String? {
        self == .all ? nil : rawValue
    }
}

private enum MediaSort: String, CaseIterable, Identifiable {
    case added_at, last_grabbed_at, title, year, status, digital_release_date, file_size
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .added_at: "Date added"
        case .last_grabbed_at: "Last download"
        case .title: "Title"
        case .year: "Year"
        case .status: "Status"
        case .digital_release_date: "Digital release"
        case .file_size: "File size"
        }
    }
}

private enum BookKindFilter: String, CaseIterable, Identifiable {
    case all, audiobook, ebook
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .audiobook: "Audiobook"
        case .ebook: "Ebook"
        }
    }
}

private enum BookSort: String, CaseIterable, Identifiable {
    /// Books still being read/listened, most recently touched first, then the
    /// rest in the server's latest-added order. The web app's default order.
    case recent, title, author
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .recent: "Recent"
        case .title: "Title"
        case .author: "Author"
        }
    }
}

/// Two densities only (not the web's three): the default poster grid and an
/// opt-in list. Persisted per-device via `@AppStorage`.
private enum LibraryDensity: String, CaseIterable {
    case grid, list
}

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// List mutations animate with the app spring, degrading to a crossfade
    /// under Reduce Motion (RawkoonMotion consumers must be Reduce-Motion safe).
    private var listMotion: Animation {
        reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.spring
    }

    @State private var section: LibrarySection = .media

    /// Grid is the default so the first open is byte-identical to today.
    @AppStorage("library.density") private var densityRaw = LibraryDensity.grid.rawValue

    // Media filters/sort — web defaults.
    @State private var mediaType: MediaTypeFilter = .all
    @State private var mediaStatus: MediaStatusFilter = .all
    @State private var sort: MediaSort = .added_at
    @State private var sortAscending = false
    @State private var mediaSearch = ""
    @State private var media: [LibraryMedia] = []
    @State private var mediaPage = 1
    @State private var mediaHasMore = false
    @State private var loadingMedia = false
    @State private var loadingMoreMedia = false
    /// Bumped on every reset so a superseded load-more or live reload discards its result.
    @State private var loadGeneration = 0
    @State private var mediaError: String?
    @State private var releaseSearch: ReleaseSearchPresentation?
    @State private var removeCandidate: LibraryMedia?
    @State private var showingRemoveConfirm = false
    @State private var menuDetailMedia: LibraryMedia?
    @State private var showingPlayer = false
    /// The in-flight live-event reload, cancelled before a new one starts so
    /// rapid `/api/library/events` bursts can't race the list state.
    @State private var liveReloadTask: Task<Void, Never>?
    @State private var readingBook: BookListItem?
    @State private var markReadBook: BookListItem?
    @State private var busyMediaIds: Set<Int> = []

    @State private var bookKind: BookKindFilter = .all
    @State private var bookSearch = ""
    @State private var bookSort: BookSort = .recent
    @State private var busyBookIds: Set<Int> = []
    /// Local books error, captured at the load site so a stale/unrelated
    /// `model.errorMessage` can't leak into the books view.
    @State private var booksError: String?
    // Per-user progress that drives the `.recent` sort, keyed by edition id.
    @State private var audioProgress: [Int: RemoteProgress] = [:]
    @State private var ebookProgress: [Int: ReadingPosition] = [:]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    private var density: LibraryDensity {
        LibraryDensity(rawValue: densityRaw) ?? .grid
    }

    private var densityBinding: Binding<LibraryDensity> {
        Binding(get: { density }, set: { densityRaw = $0.rawValue })
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $section) {
                ForEach(LibrarySection.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if model.isOfflineLibrary {
                offlineBanner
            }

            if section == .media {
                mediaToolbar
            } else {
                booksToolbar
            }

            content
        }
        .background(Theme.base)
        .navigationTitle("Library")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if section == .media {
                    Menu {
                        Picker("Layout", selection: densityBinding) {
                            Label("Grid", systemImage: "square.grid.2x2").tag(LibraryDensity.grid)
                            Label("List", systemImage: "list.bullet").tag(LibraryDensity.list)
                        }
                    } label: {
                        Label("Layout", systemImage: density == .grid ? "square.grid.2x2" : "list.bullet")
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    RequestsView()
                } label: {
                    Label("Requests", systemImage: "tray.and.arrow.down")
                }
            }
        }
        .task {
            // Only the first appearance loads — `.task` re-runs when we pop back
            // from a pushed detail, and a reset there would drop loaded pages and
            // reset the scroll position. Live edits keep the list fresh instead.
            if section == .media, media.isEmpty {
                await loadMedia(reset: true)
            }
            if model.library.isEmpty {
                await loadBooks()
            }
            await loadBookProgress()
        }
        .onChange(of: mediaFilterKey) { _, _ in
            Task { await loadMedia(reset: true) }
        }
        .onChange(of: section) { _, newSection in
            if newSection == .media {
                Task { await loadMedia(reset: true) }
            } else {
                Task { await loadBookProgress() }
            }
        }
        .onChange(of: model.libraryChangeToken) { _, _ in
            guard section == .media else { return }
            // Cancel any reload still in flight before starting the next one, so
            // a burst of SSE events can't run overlapping resets that race the
            // paginated @State (the superseded fetch throws on cancellation
            // rather than writing a stale page).
            liveReloadTask?.cancel()
            liveReloadTask = Task { await reloadLoadedWindow() }
        }
        .onChange(of: model.bookChangeToken) { _, _ in
            guard section == .books else { return }
            liveReloadTask?.cancel()
            liveReloadTask = Task {
                await model.loadLibrary()
                await loadBookProgress()
            }
        }
        .sheet(item: $releaseSearch) { target in
            ReleaseSearchView(
                query: target.query,
                libraryMediaId: target.libraryMediaId,
                tmdbId: target.tmdbId,
                mediaType: target.mediaType,
                availableSeasons: []
            )
            .environment(model)
        }
        .sheet(isPresented: $showingPlayer) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environment(model)
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { menuDetailMedia != nil },
            set: {
                if !$0 {
                    menuDetailMedia = nil
                }
            }
        )) {
            if let m = menuDetailMedia {
                MediaDetailView(
                    tmdbId: m.tmdbId,
                    mediaType: m.type == "show" ? "tv" : "movie",
                    title: m.title,
                    posterPath: m.posterUrl,
                    libraryId: m.id
                )
            }
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
        .libraryRemoveConfirmation(
            isPresented: $showingRemoveConfirm,
            title: removeCandidate?.title ?? ""
        ) { deleteFiles in
            if let media = removeCandidate {
                Task { await removeFromLibrary(media, deleteFiles: deleteFiles) }
            }
        }
        .rawkoonConfirm(
            "Mark as read?",
            isPresented: Binding(
                get: { markReadBook != nil },
                set: {
                    if !$0 {
                        markReadBook = nil
                    }
                }
            )
        ) {
            Button("Mark as read") {
                if let book = markReadBook {
                    Task { await model.setBookRead(book, read: true) }
                }
                markReadBook = nil
            }
            Button("Cancel", role: .cancel) { markReadBook = nil }
        } message: {
            Text("This resets ebook and audiobook progress.")
        }
    }

    private var normalizedMediaSearch: String {
        mediaSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var mediaFilterKey: String {
        "\(mediaType.rawValue)|\(mediaStatus.rawValue)|\(sort.rawValue)|\(sortAscending)|\(normalizedMediaSearch)"
    }

    // MARK: Toolbars

    private var mediaToolbar: some View {
        VStack(spacing: 8) {
            searchField("Search titles", text: $mediaSearch)
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    filterMenu(title: mediaType.title, systemImage: "film") {
                        ForEach(MediaTypeFilter.allCases) { t in
                            Button(t.title) { mediaType = t }
                        }
                    }
                    filterMenu(title: mediaStatus.title, systemImage: "line.3.horizontal.decrease") {
                        ForEach(MediaStatusFilter.allCases) { s in
                            Button(s.title) { mediaStatus = s }
                        }
                    }
                    filterMenu(title: sort.title, systemImage: sortAscending ? "arrow.up" : "arrow.down") {
                        ForEach(MediaSort.allCases) { s in
                            Button(s.title) { sort = s }
                        }
                        Divider()
                        Button(LocalizedStringKey(sortAscending ? "Descending" : "Ascending")) { sortAscending.toggle() }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
        }
    }

    private var booksToolbar: some View {
        VStack(spacing: 8) {
            searchField("Search books", text: $bookSearch)
                .padding(.horizontal, 16)
            HStack(spacing: 8) {
                filterMenu(title: bookKind.title, systemImage: "books.vertical") {
                    ForEach(BookKindFilter.allCases) { k in
                        Button(k.title) { bookKind = k }
                    }
                }
                filterMenu(title: bookSort.title, systemImage: "arrow.up.arrow.down") {
                    ForEach(BookSort.allCases) { s in
                        Button(s.title) { bookSort = s }
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func filterMenu(title: LocalizedStringKey, systemImage: String, @ViewBuilder content: () -> some View) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: systemImage).font(.caption2)
                Text(title).font(.subheadline.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if section == .media {
            ZStack {
                if density == .list {
                    mediaList
                } else {
                    mediaGrid
                }
            }
            .rawkoonMotion(RawkoonMotion.spring, value: density)
        } else {
            booksGrid
        }
    }

    private var mediaGrid: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(media) { m in
                        NavigationLink {
                            MediaDetailView(
                                tmdbId: m.tmdbId,
                                mediaType: m.type == "show" ? "tv" : "movie",
                                title: m.title,
                                posterPath: m.posterUrl,
                                libraryId: m.id
                            )
                        } label: {
                            MediaPosterCard(
                                title: m.title,
                                posterURL: model.absoluteURL(m.posterUrl),
                                menuItems: mediaPosterMenuItems(inLibrary: true, isAdmin: model.isAdmin),
                                onMenuAction: { handleMediaMenu($0, media: m) }
                            ) {
                                if busyMediaIds.contains(m.id) {
                                    ProgressView().tint(Theme.apricot)
                                } else {
                                    mediaBadge(for: m)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)

                if mediaHasMore {
                    paginationFooter
                }
            }
            .padding(.vertical, 16)
        }
        .overlay { mediaOverlay }
        .refreshable { await loadMedia(reset: true) }
    }

    /// Infinite-scroll sentinel. Lives inside the lazy container so its `onAppear`
    /// fires only when scrolled near the end — and re-fires each time it reappears,
    /// so a failed page can be retried and a deleted last row can't strand it.
    @ViewBuilder
    private var paginationFooter: some View {
        Group {
            if let mediaError, !media.isEmpty {
                Button {
                    Task { await loadMedia(reset: false) }
                } label: {
                    VStack(spacing: 4) {
                        Text(mediaError).font(.caption).foregroundStyle(Theme.muted)
                        Text("Tap to retry").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                    }
                }
                .buttonStyle(.plain)
            } else {
                ProgressView().tint(Theme.apricot)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .onAppear { loadMoreIfNeeded() }
    }

    @ViewBuilder
    private func mediaBadge(for m: LibraryMedia) -> some View {
        if m.status == "downloading" {
            Circle().fill(Theme.importing).frame(width: 22, height: 22)
                .overlay(Image(systemName: "arrow.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.onAccent))
        } else if m.status == "wanted" || m.status == "missing" {
            Circle().fill(Theme.muted.opacity(0.9)).frame(width: 22, height: 22)
                .overlay(Image(systemName: "questionmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.base))
        }
    }

    @ViewBuilder
    private var mediaOverlay: some View {
        if loadingMedia, media.isEmpty {
            if density == .list {
                mediaListSkeleton
            } else {
                mediaGridSkeleton
            }
        } else if let mediaError, media.isEmpty {
            ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(mediaError))
        } else if !loadingMedia, mediaError == nil, media.isEmpty {
            ContentUnavailableView("No titles", systemImage: "film", description: Text("Nothing matches these filters."))
        }
    }

    /// Warm skeleton poster grid shown while the first media page loads.
    private var mediaGridSkeleton: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(0 ..< 9, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        ShimmerView(cornerRadius: 10)
                            .aspectRatio(2.0 / 3.0, contentMode: .fit)
                        ShimmerView(cornerRadius: 4).frame(height: 12)
                    }
                }
            }
            .padding(16)
        }
        .allowsHitTesting(false)
    }

    /// Warm skeleton rows matching the list layout while the first page loads.
    private var mediaListSkeleton: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(0 ..< 8, id: \.self) { _ in
                    HStack(alignment: .top, spacing: 12) {
                        ShimmerView(cornerRadius: 6).frame(width: 46, height: 69)
                        VStack(alignment: .leading, spacing: 6) {
                            ShimmerView(cornerRadius: 4).frame(height: 14)
                            ShimmerView(cornerRadius: 4).frame(width: 140, height: 10)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 16)
        }
        .allowsHitTesting(false)
    }

    private var mediaList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(media) { m in
                    NavigationLink {
                        MediaDetailView(
                            tmdbId: m.tmdbId,
                            mediaType: m.type == "show" ? "tv" : "movie",
                            title: m.title,
                            posterPath: m.posterUrl,
                            libraryId: m.id
                        )
                    } label: {
                        LibraryMediaRow(
                            media: m,
                            posterURL: model.absoluteURL(m.posterUrl),
                            isBusy: busyMediaIds.contains(m.id),
                            menuItems: mediaPosterMenuItems(inLibrary: true, isAdmin: model.isAdmin),
                            onMenuAction: { handleMediaMenu($0, media: m) }
                        )
                    }
                    .buttonStyle(.plain)
                }

                if mediaHasMore {
                    paginationFooter
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 16)
        }
        .overlay { mediaOverlay }
        .refreshable { await loadMedia(reset: true) }
    }

    private var booksGrid: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(filteredBooks) { book in
                    NavigationLink {
                        BookView(book: book)
                    } label: {
                        BookRow(
                            book: book,
                            downloaded: isDownloaded(book),
                            menuItems: bookCardMenuItems(
                                hasAudiobook: book.hasAudiobook,
                                hasEbook: book.hasEbook,
                                isAdmin: model.isAdmin,
                                isRead: book.isRead
                            ),
                            onMenuAction: { handleBookMenu($0, book: book) }
                        )
                        .overlay(alignment: .trailing) {
                            if busyBookIds.contains(book.bookId) {
                                ProgressView().tint(Theme.muted).padding(.trailing, 10)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .overlay {
            if model.loading, model.library.isEmpty {
                booksSkeleton
            } else if let booksError, model.library.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load books", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(booksError)
                } actions: {
                    Button("Try again") { Task { await loadBooks() } }
                        .buttonStyle(.bordered)
                        .tint(Theme.apricot)
                }
            } else if !model.loading, filteredBooks.isEmpty {
                ContentUnavailableView("No books", systemImage: "books.vertical", description: Text("Books added on your server show up here."))
            }
        }
        .refreshable { await loadBooks() }
    }

    /// Warm skeleton rows matching `BookRow` while the first books page loads.
    private var booksSkeleton: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(0 ..< 8, id: \.self) { _ in
                    HStack(spacing: 12) {
                        ShimmerView(cornerRadius: 10).frame(width: 56, height: 56)
                        VStack(alignment: .leading, spacing: 6) {
                            ShimmerView(cornerRadius: 4).frame(height: 15)
                            ShimmerView(cornerRadius: 4).frame(width: 120, height: 11)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .allowsHitTesting(false)
    }

    private var offlineBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
            Text("Offline — showing downloaded books")
            Spacer(minLength: 0)
        }
        .font(.caption)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var filteredBooks: [BookListItem] {
        let filtered = model.library.filter { book in
            switch bookKind {
            case .all: true
            case .audiobook: book.hasAudiobook
            case .ebook: book.hasEbook
            }
        }.filter { book in
            let query = bookSearch.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty else { return true }
            let haystack = "\(book.title) \(book.author ?? "")".lowercased()
            return haystack.contains(query.lowercased())
        }

        switch bookSort {
        case .recent:
            // Floats books with an active read to the top; ties and inactive
            // books fall back to the server's order (added_at desc), which
            // `model.library` already carries.
            let order = Dictionary(
                uniqueKeysWithValues: model.library.enumerated().map { ($1.bookId, $0) }
            )
            return filtered.sorted { lhs, rhs in
                let l = lastReadMillis(lhs)
                let r = lastReadMillis(rhs)
                if l != r {
                    return l > r
                }
                return (order[lhs.bookId] ?? 0) < (order[rhs.bookId] ?? 0)
            }
        case .title:
            return filtered.sorted {
                $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
        case .author:
            return filtered.sorted {
                let left = $0.author ?? $0.title
                let right = $1.author ?? $1.title
                return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
            }
        }
    }

    /// The most recent unfinished read/listen across a book's editions, in epoch
    /// millis. Zero when nothing is in progress — the same "some real progress,
    /// not finished" test the Continue shelf and the web app use.
    private func lastReadMillis(_ book: BookListItem) -> Int64 {
        var best: Int64 = 0
        if
            let editionId = book.audiobookEditionId,
            let p = audioProgress[editionId],
            !p.finished, p.positionSecs > 1, p.totalDurationSecs > 1
        {
            best = max(best, Int64(p.updatedAt.timeIntervalSince1970 * 1000))
        }
        if
            let editionId = book.ebookEditionId,
            let p = ebookProgress[editionId],
            !p.finished, p.spineIndex > 0 || p.scrollFraction > 0.01
        {
            best = max(best, p.updatedAtMillis)
        }
        return best
    }

    /// Loads the books library and captures any failure locally, so the books
    /// view shows this load's own error (with a retry) rather than the shared,
    /// possibly stale, `model.errorMessage`.
    private func loadBooks() async {
        booksError = nil
        await model.loadLibrary()
        // `loadLibrary` clears then sets `model.errorMessage` within its own
        // scope, so reading it right here reflects this load's outcome.
        booksError = model.errorMessage
    }

    /// Loads audiobook and ebook progress for the `.recent` sort. Best effort:
    /// a failure just leaves the list in latest-added order.
    private func loadBookProgress() async {
        guard let client = model.api() else { return }
        let audio = try? await client.getProgress()
        let ebook = try? await client.readingProgress()
        if let audio {
            audioProgress = Dictionary(
                audio.map { ($0.editionId, $0) },
                uniquingKeysWith: { first, _ in first }
            )
        }
        if let ebook {
            ebookProgress = Dictionary(
                ebook.map { ($0.editionId, $0) },
                uniquingKeysWith: { first, _ in first }
            )
        }
    }

    private func isDownloaded(_ book: BookListItem) -> Bool {
        guard let id = book.audiobookEditionId else { return false }
        return model.downloadPlans[id]?.isComplete == true
    }

    private func loadMedia(reset: Bool) async {
        guard let client = model.api() else { return }

        if reset {
            // A reset supersedes any load-more and any live reload in flight — bump
            // the generation so their late results are discarded, not applied.
            loadGeneration += 1
            liveReloadTask?.cancel()
            loadingMedia = true
        } else {
            guard !loadingMoreMedia, !loadingMedia else { return }
            loadingMoreMedia = true
        }
        mediaError = nil
        defer {
            if reset {
                loadingMedia = false
            } else {
                loadingMoreMedia = false
            }
        }

        let gen = loadGeneration
        let targetPage = reset ? 1 : (mediaPage + 1)
        do {
            let response = try await client.libraryList(
                type: mediaType.param,
                status: mediaStatus.param,
                q: normalizedMediaSearch.isEmpty ? nil : normalizedMediaSearch,
                page: targetPage,
                limit: 60,
                sortBy: sort.rawValue,
                sortDir: sortAscending ? "asc" : "desc"
            )
            // A newer reset (filter/search change) ran while we awaited — drop this.
            guard gen == loadGeneration else { return }
            mediaPage = targetPage
            mediaHasMore = response.hasMore == true
            if reset {
                media = response.items
            } else {
                var merged = media
                for item in response.items where !merged.contains(where: { $0.id == item.id }) {
                    merged.append(item)
                }
                media = merged
            }
        } catch {
            guard gen == loadGeneration else { return }
            mediaError = errorMessage(for: error)
        }
    }

    /// Infinite scroll: the footer sentinel scrolled into view — fetch the next page.
    /// A load-more error blocks auto-retry (the footer shows a manual retry instead).
    private func loadMoreIfNeeded() {
        guard mediaHasMore, !loadingMoreMedia, !loadingMedia, mediaError == nil else { return }
        Task { await loadMedia(reset: false) }
    }

    /// Refetch every page currently loaded and replace in place, so a live event
    /// refreshes content without collapsing to page 1 — which would drop the pages
    /// the user scrolled past and reset their scroll position. Same item ids keep
    /// the grid's identity, so the scroll offset survives.
    private func reloadLoadedWindow() async {
        guard let client = model.api() else { return }
        let gen = loadGeneration
        let pages = max(mediaPage, 1)
        // Snapshot the filters so a mid-loop change can't stitch pages from two filters.
        let type = mediaType.param
        let status = mediaStatus.param
        let q = normalizedMediaSearch.isEmpty ? nil : normalizedMediaSearch
        let sortBy = sort.rawValue
        let sortDir = sortAscending ? "asc" : "desc"
        do {
            var merged: [LibraryMedia] = []
            var hasMore = false
            for page in 1 ... pages {
                try Task.checkCancellation()
                let response = try await client.libraryList(
                    type: type,
                    status: status,
                    q: q,
                    page: page,
                    limit: 60,
                    sortBy: sortBy,
                    sortDir: sortDir
                )
                for item in response.items where !merged.contains(where: { $0.id == item.id }) {
                    merged.append(item)
                }
                hasMore = response.hasMore == true
            }
            try Task.checkCancellation()
            // Discard if a reset ran or a load-more grew the window while we fetched.
            guard gen == loadGeneration, pages == max(mediaPage, 1) else { return }
            mediaHasMore = hasMore
            // Stable ids mean a single-item live change animates as one reflow.
            withAnimation(listMotion) {
                media = merged
            }
        } catch {
            // Cancelled or transient — keep the current list.
        }
    }

    private func errorMessage(for error: Error) -> String {
        guard let apiError = error as? APIError else { return String(localized: "Unexpected error.") }
        return apiError.userMessage(
            unauthorized: String(localized: "Sign in required."),
            transport: String(localized: "Network error.")
        )
    }

    private func handleMediaMenu(_ action: MediaPosterMenuAction, media: LibraryMedia) {
        switch action {
        case .toggleMonitored:
            Task { await toggleMonitored(media) }
        case .searchReleases:
            releaseSearch = ReleaseSearchPresentation(
                query: media.title,
                libraryMediaId: media.id,
                tmdbId: media.tmdbId,
                mediaType: media.type == "show" ? "tv" : "movie"
            )
        case .openDetails:
            menuDetailMedia = media
        case .removeFromLibrary:
            removeCandidate = media
            showingRemoveConfirm = true
        }
    }

    private func handleBookMenu(_ action: BookCardMenuAction, book: BookListItem) {
        guard !busyBookIds.contains(book.bookId) else { return }
        switch action {
        case .read:
            readingBook = book
        case .play:
            busyBookIds.insert(book.bookId)
            Task {
                await playAudiobook(book)
                busyBookIds.remove(book.bookId)
            }
        case .markRead:
            markReadBook = book
        case .markUnread:
            busyBookIds.insert(book.bookId)
            Task {
                await model.setBookRead(book, read: false)
                busyBookIds.remove(book.bookId)
            }
        case .addAudiobook:
            busyBookIds.insert(book.bookId)
            Task {
                await addEdition(book: book, kind: "audiobook")
                busyBookIds.remove(book.bookId)
            }
        case .addEbook:
            busyBookIds.insert(book.bookId)
            Task {
                await addEdition(book: book, kind: "ebook")
                busyBookIds.remove(book.bookId)
            }
        case .rescan:
            busyBookIds.insert(book.bookId)
            Task {
                await rescanBook(book)
                busyBookIds.remove(book.bookId)
            }
        }
    }

    private func toggleMonitored(_ media: LibraryMedia) async {
        guard let client = model.api(), !busyMediaIds.contains(media.id) else { return }
        busyMediaIds.insert(media.id)
        do {
            let updated = try await client.updateLibraryMonitored(id: media.id, monitored: !media.monitored)
            // Optimistic in-place swap — no refetch, so scroll and loaded pages stay put.
            if let idx = self.media.firstIndex(where: { $0.id == updated.id }) {
                withAnimation(listMotion) {
                    self.media[idx] = updated
                }
            }
            model.toast(media.monitored ? String(localized: "Unmonitored.") : String(localized: "Monitored."), style: .success)
        } catch {
            model.toast(errorMessage(for: error), style: .error)
        }
        busyMediaIds.remove(media.id)
    }

    private func removeFromLibrary(_ media: LibraryMedia, deleteFiles: Bool) async {
        guard let client = model.api() else { return }
        busyMediaIds.insert(media.id)
        do {
            try await client.removeFromLibrary(id: media.id, deleteFiles: deleteFiles)
            removeCandidate = nil
            // Optimistic removal — drop the row locally instead of refetching page 1,
            // which would reset scroll and drop the pages already loaded. Animated so
            // the remaining cells reflow into the gap.
            withAnimation(listMotion) {
                self.media.removeAll { $0.id == media.id }
            }
            model.toast(String(localized: "Removed from library."), style: .success)
            // Removing the last loaded row while more pages exist would strand the
            // list on an empty view with no sentinel to fire — pull the next page in.
            if self.media.isEmpty, mediaHasMore {
                await loadMedia(reset: true)
            }
        } catch {
            model.toast(errorMessage(for: error), style: .error)
        }
        busyMediaIds.remove(media.id)
    }

    private func playAudiobook(_ book: BookListItem) async {
        guard let editionId = book.audiobookEditionId else { return }
        await model.openPlayer(editionId: editionId)
        if model.errorMessage == nil {
            showingPlayer = true
        } else {
            model.toast(model.errorMessage ?? String(localized: "Could not start playback."), style: .error)
        }
    }

    private func addEdition(book: BookListItem, kind: String) async {
        guard let client = model.api() else { return }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
            model.toast(String(localized: "Added \(kind == "audiobook" ? "audiobook" : "ebook") edition."), style: .success)
        } catch {
            model.toast(errorMessage(for: error), style: .error)
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
            model.toast(String(localized: "Rescan started."), style: .success)
        } catch {
            model.toast(errorMessage(for: error), style: .error)
        }
    }
}
