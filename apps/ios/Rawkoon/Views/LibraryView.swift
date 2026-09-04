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

struct LibraryView: View {
    @Environment(AppModel.self) private var model

    @State private var section: LibrarySection = .media

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
    @State private var busyMediaIds: Set<Int> = []

    @State private var bookKind: BookKindFilter = .all
    @State private var bookSearch = ""
    @State private var bookSort: BookSort = .recent
    @State private var busyBookIds: Set<Int> = []
    // Per-user progress that drives the `.recent` sort, keyed by edition id.
    @State private var audioProgress: [Int: RemoteProgress] = [:]
    @State private var ebookProgress: [Int: ReadingPosition] = [:]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

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
                NavigationLink {
                    RequestsView()
                } label: {
                    Label("Requests", systemImage: "tray.and.arrow.down")
                }
            }
        }
        .task {
            if section == .media {
                await loadMedia(reset: true)
            }
            if model.library.isEmpty {
                await model.loadLibrary()
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
            liveReloadTask = Task { await loadMedia(reset: true) }
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
            mediaGrid
        } else {
            booksGrid
        }
    }

    private var mediaGrid: some View {
        ScrollView {
            VStack(spacing: 16) {
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
                    Button {
                        Task { await loadMedia(reset: false) }
                    } label: {
                        if loadingMoreMedia {
                            ProgressView().tint(Theme.apricot)
                        } else {
                            Text("Load more")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.text)
                        }
                    }
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
                }
            }
            .padding(.vertical, 16)
        }
        .overlay { mediaOverlay }
        .refreshable { await loadMedia(reset: true) }
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
            ProgressView().tint(Theme.apricot)
        } else if let mediaError, media.isEmpty {
            ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(mediaError))
        } else if !loadingMedia, mediaError == nil, media.isEmpty {
            ContentUnavailableView("No titles", systemImage: "film", description: Text("Nothing matches these filters."))
        }
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
                                isAdmin: model.isAdmin
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
                ProgressView().tint(Theme.apricot)
            } else if let error = model.errorMessage, model.library.isEmpty {
                ContentUnavailableView("Couldn't load books", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if !model.loading, filteredBooks.isEmpty {
                ContentUnavailableView("No books", systemImage: "books.vertical", description: Text("Books added on your server show up here."))
            }
        }
        .refreshable { await model.loadLibrary() }
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
            loadingMedia = true
        } else {
            guard !loadingMoreMedia else { return }
            loadingMoreMedia = true
        }
        mediaError = nil
        defer {
            loadingMedia = false
            loadingMoreMedia = false
        }

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
            mediaError = errorMessage(for: error)
        }
    }

    private func errorMessage(for error: Error) -> String {
        guard let apiError = error as? APIError else { return String(localized: "Unexpected error.") }
        switch apiError {
        case .unauthorized: return String(localized: "Sign in required.")
        case let .http(status): return String(localized: "Server error (\(status)).")
        case .decode: return String(localized: "Could not parse server response.")
        case .transport: return String(localized: "Network error.")
        }
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
            _ = try await client.updateLibraryMonitored(id: media.id, monitored: !media.monitored)
            await loadMedia(reset: true)
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
            await loadMedia(reset: true)
            model.toast(String(localized: "Removed from library."), style: .success)
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
