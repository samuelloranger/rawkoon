import RawkoonKit
import SwiftUI

private enum LibrarySection: String, CaseIterable, Identifiable {
    case media = "Media"
    case books = "Books"
    var id: String {
        rawValue
    }
}

/// Defaults mirror the web app: type=all, status=all, sort=added_at desc.
private enum MediaTypeFilter: String, CaseIterable, Identifiable {
    case all, movie, show
    var id: String {
        rawValue
    }

    var label: String {
        self == .all ? "All" : self == .movie ? "Movies" : "Shows"
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

    var label: String {
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

    var label: String {
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

    var label: String {
        self == .all ? "All" : self == .audiobook ? "Audiobook" : "Ebook"
    }
}

private enum BookSort: String, CaseIterable, Identifiable {
    case title, author
    var id: String {
        rawValue
    }

    var label: String {
        switch self {
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
    @State private var readingBook: BookListItem?

    @State private var bookKind: BookKindFilter = .all
    @State private var bookSearch = ""
    @State private var bookSort: BookSort = .title

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $section) {
                ForEach(LibrarySection.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

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
        }
        .onChange(of: mediaFilterKey) { _, _ in
            Task { await loadMedia(reset: true) }
        }
        .onChange(of: section) { _, newSection in
            if newSection == .media {
                Task { await loadMedia(reset: true) }
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
                    filterMenu(title: mediaType.label, systemImage: "film") {
                        ForEach(MediaTypeFilter.allCases) { t in
                            Button(t.label) { mediaType = t }
                        }
                    }
                    filterMenu(title: mediaStatus.label, systemImage: "line.3.horizontal.decrease") {
                        ForEach(MediaStatusFilter.allCases) { s in
                            Button(s.label) { mediaStatus = s }
                        }
                    }
                    filterMenu(title: sort.label, systemImage: sortAscending ? "arrow.up" : "arrow.down") {
                        ForEach(MediaSort.allCases) { s in
                            Button(s.label) { sort = s }
                        }
                        Divider()
                        Button(sortAscending ? "Descending" : "Ascending") { sortAscending.toggle() }
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
                filterMenu(title: bookKind.label, systemImage: "books.vertical") {
                    ForEach(BookKindFilter.allCases) { k in
                        Button(k.label) { bookKind = k }
                    }
                }
                filterMenu(title: bookSort.label, systemImage: "arrow.up.arrow.down") {
                    ForEach(BookSort.allCases) { s in
                        Button(s.label) { bookSort = s }
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func filterMenu(title: String, systemImage: String, @ViewBuilder content: () -> some View) -> some View {
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
                                mediaBadge(for: m)
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
        guard let apiError = error as? APIError else { return "Unexpected error." }
        switch apiError {
        case .unauthorized: return "Sign in required."
        case let .http(status): return "Server error (\(status))."
        case .decode: return "Could not parse server response."
        case .transport: return "Network error."
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
        switch action {
        case .read:
            readingBook = book
        case .play:
            Task { await playAudiobook(book) }
        case .addAudiobook:
            Task { await addEdition(book: book, kind: "audiobook") }
        case .addEbook:
            Task { await addEdition(book: book, kind: "ebook") }
        case .rescan:
            Task { await rescanBook(book) }
        }
    }

    private func toggleMonitored(_ media: LibraryMedia) async {
        guard let client = model.api() else { return }
        do {
            _ = try await client.updateLibraryMonitored(id: media.id, monitored: !media.monitored)
            await loadMedia(reset: true)
        } catch {
            mediaError = errorMessage(for: error)
        }
    }

    private func removeFromLibrary(_ media: LibraryMedia, deleteFiles: Bool) async {
        guard let client = model.api() else { return }
        do {
            try await client.removeFromLibrary(id: media.id, deleteFiles: deleteFiles)
            removeCandidate = nil
            await loadMedia(reset: true)
        } catch {
            mediaError = errorMessage(for: error)
        }
    }

    private func playAudiobook(_ book: BookListItem) async {
        guard let editionId = book.audiobookEditionId else { return }
        await model.openPlayer(editionId: editionId)
        if model.errorMessage == nil {
            showingPlayer = true
        }
    }

    private func addEdition(book: BookListItem, kind: String) async {
        guard let client = model.api() else { return }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
        } catch {
            mediaError = errorMessage(for: error)
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
        } catch {
            mediaError = errorMessage(for: error)
        }
    }
}
