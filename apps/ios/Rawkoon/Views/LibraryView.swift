import SwiftUI

private enum LibrarySection: String, CaseIterable, Identifiable {
    case media = "Media"
    case books = "Books"
    var id: String { rawValue }
}

// Defaults mirror the web app: type=all, status=all, sort=added_at desc.
private enum MediaTypeFilter: String, CaseIterable, Identifiable {
    case all, movie, show
    var id: String { rawValue }
    var label: String { self == .all ? "All" : self == .movie ? "Movies" : "Shows" }
    var param: String? { self == .all ? nil : rawValue }
}

private enum MediaStatusFilter: String, CaseIterable, Identifiable {
    case all, downloaded, wanted, downloading
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return "All"
        case .downloaded: return "Downloaded"
        case .wanted: return "Missing"
        case .downloading: return "Downloading"
        }
    }
    var param: String? { self == .all ? nil : rawValue }
}

private enum MediaSort: String, CaseIterable, Identifiable {
    case added_at, last_grabbed_at, title, year, status, digital_release_date, file_size
    var id: String { rawValue }
    var label: String {
        switch self {
        case .added_at: return "Date added"
        case .last_grabbed_at: return "Last download"
        case .title: return "Title"
        case .year: return "Year"
        case .status: return "Status"
        case .digital_release_date: return "Digital release"
        case .file_size: return "File size"
        }
    }
}

private enum BookKindFilter: String, CaseIterable, Identifiable {
    case all, audiobook, ebook
    var id: String { rawValue }
    var label: String { self == .all ? "All" : self == .audiobook ? "Audiobook" : "Ebook" }
}

struct LibraryView: View {
    @EnvironmentObject private var model: AppModel

    @State private var section: LibrarySection = .media

    // Media filters/sort — web defaults.
    @State private var mediaType: MediaTypeFilter = .all
    @State private var mediaStatus: MediaStatusFilter = .all
    @State private var sort: MediaSort = .added_at
    @State private var sortAscending = false
    @State private var media: [LibraryMedia] = []
    @State private var loadingMedia = false
    @State private var mediaError: String?

    @State private var bookKind: BookKindFilter = .all

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $section) {
                ForEach(LibrarySection.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if section == .media { mediaToolbar } else { booksToolbar }

            content
        }
        .background(Theme.base)
        .navigationTitle("Library")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if section == .media { await loadMedia() }
            if model.library.isEmpty { await model.loadLibrary() }
        }
        .onChange(of: mediaFilterKey) { _, _ in
            Task { await loadMedia() }
        }
        .onChange(of: section) { _, newSection in
            if newSection == .media { Task { await loadMedia() } }
        }
    }

    private var mediaFilterKey: String {
        "\(mediaType.rawValue)|\(mediaStatus.rawValue)|\(sort.rawValue)|\(sortAscending)"
    }

    // MARK: Toolbars

    private var mediaToolbar: some View {
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

    private var booksToolbar: some View {
        HStack(spacing: 8) {
            filterMenu(title: bookKind.label, systemImage: "books.vertical") {
                ForEach(BookKindFilter.allCases) { k in
                    Button(k.label) { bookKind = k }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func filterMenu<Content: View>(title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: systemImage).font(.caption2)
                Text(title).font(.subheadline.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if section == .media { mediaGrid } else { booksGrid }
    }

    private var mediaGrid: some View {
        ScrollView {
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
                        MediaPosterCard(title: m.title, posterURL: model.absoluteURL(m.posterUrl)) {
                            mediaBadge(for: m)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .overlay { mediaOverlay }
        .refreshable { await loadMedia() }
    }

    @ViewBuilder
    private func mediaBadge(for m: LibraryMedia) -> some View {
        if m.status == "downloading" {
            Circle().fill(Theme.apricot).frame(width: 22, height: 22)
                .overlay(Image(systemName: "arrow.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.onAccent))
        } else if m.status == "wanted" || m.status == "missing" {
            Circle().fill(Theme.muted.opacity(0.9)).frame(width: 22, height: 22)
                .overlay(Image(systemName: "questionmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.base))
        }
    }

    @ViewBuilder
    private var mediaOverlay: some View {
        if loadingMedia && media.isEmpty {
            ProgressView().tint(Theme.apricot)
        } else if let mediaError, media.isEmpty {
            ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(mediaError))
        } else if !loadingMedia && mediaError == nil && media.isEmpty {
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
                        BookRow(book: book, downloaded: isDownloaded(book))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .overlay {
            if model.loading && model.library.isEmpty {
                ProgressView().tint(Theme.apricot)
            } else if !model.loading && filteredBooks.isEmpty {
                ContentUnavailableView("No books", systemImage: "books.vertical", description: Text("Books added on your server show up here."))
            }
        }
        .refreshable { await model.loadLibrary() }
    }

    private var filteredBooks: [BookListItem] {
        model.library.filter { book in
            switch bookKind {
            case .all: return true
            case .audiobook: return book.hasAudiobook
            case .ebook: return book.hasEbook
            }
        }
    }

    private func isDownloaded(_ book: BookListItem) -> Bool {
        guard let id = book.audiobookEditionId else { return false }
        return model.downloadPlans[id]?.isComplete == true
    }

    private func loadMedia() async {
        guard let client = model.api() else { return }
        loadingMedia = true
        mediaError = nil
        defer { loadingMedia = false }
        do {
            let response = try await client.libraryList(
                type: mediaType.param,
                status: mediaStatus.param,
                sortBy: sort.rawValue,
                sortDir: sortAscending ? "asc" : "desc"
            )
            media = response.items
        } catch {
            mediaError = errorMessage(for: error)
        }
    }

    private func errorMessage(for error: Error) -> String {
        guard let apiError = error as? APIError else { return "Unexpected error." }
        switch apiError {
        case .unauthorized: return "Admin only."
        case let .http(status): return "Server error (\(status))."
        case .decode: return "Could not parse server response."
        case .transport: return "Network error."
        }
    }
}

/// A merged book row: cover, title/author, and format chips (Audiobook / EPUB).
private struct BookRow: View {
    let book: BookListItem
    let downloaded: Bool

    var body: some View {
        HStack(spacing: 12) {
            BookCover(url: book.coverURL, size: 56, corner: 10)

            VStack(alignment: .leading, spacing: 5) {
                Text(book.title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                if let author = book.author, !author.isEmpty {
                    Text(author).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(1)
                }
                HStack(spacing: 6) {
                    if book.hasAudiobook { formatChip("Audiobook", tint: Theme.apricot) }
                    if book.hasEbook { formatChip("EPUB", tint: Theme.importing) }
                }
            }

            Spacer(minLength: 8)
            if downloaded { StatusBadge(text: "Offline", tint: Theme.seed) }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func formatChip(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }
}
