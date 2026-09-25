import RawkoonKit
import SwiftUI

/// The movies, shows and books search shown on Explore. The field sits above
/// the grid; two or more characters swap the grid for `MediaSearchResults`.
struct MediaSearchField: View {
    @Binding var query: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.muted)
            TextField("Search movies, shows & books", text: $query)
                .foregroundStyle(Theme.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.faint)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    /// Short queries keep showing the grid instead of a noisy result list.
    static func isActive(_ query: String) -> Bool {
        query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }
}

struct MediaSearchResults: View {
    @Environment(AppModel.self) private var model
    /// Local to this view: the zoom source and its destination both reference
    /// this namespace directly, which is the reliable pattern.
    @Namespace private var zoomNamespace

    let query: String

    @State private var kindFilter: KindFilter = .all
    @State private var searchResults: [TmdbSearchItem] = []
    @State private var bookResults: [BookSearchHit] = []
    @State private var loadingSearch = false
    @State private var searchError: String?
    @State private var addingVolumeId: String?
    @State private var requestingVolumeId: String?

    /// Reserves space for a 2-line caption at the standard content size; grows
    /// with Dynamic Type instead of clipping the title at larger sizes.
    @ScaledMetric(relativeTo: .caption) private var captionMinHeight: CGFloat = 34

    private enum KindFilter: String, CaseIterable {
        case all = "All"
        case movies = "Movies"
        case tv = "TV"
        case books = "Books"

        var apiValue: String? {
            switch self {
            case .all: nil
            case .movies: "movie"
            case .tv: "tv"
            case .books: nil
            }
        }

        var title: LocalizedStringKey {
            switch self {
            case .all: "All"
            case .movies: "Movies"
            case .tv: "TV"
            case .books: "Books"
            }
        }

        var includesMoviesAndTV: Bool {
            self != .books
        }

        var includesBooks: Bool {
            self == .all || self == .books
        }
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private struct SearchKey: Equatable {
        let query: String
        let kind: KindFilter
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            kindPicker
            searchContent
        }
        // Debounced; a new key cancels the pending search before it runs.
        .task(id: SearchKey(query: trimmedQuery, kind: kindFilter)) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await runSearch(query: trimmedQuery, kind: kindFilter)
        }
    }

    private var kindPicker: some View {
        Picker("Kind", selection: $kindFilter) {
            ForEach(KindFilter.allCases, id: \.self) { kind in
                Text(kind.title).tag(kind)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
    }

    // MARK: Search grid

    private var searchGridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    @ViewBuilder
    private var searchContent: some View {
        if loadingSearch {
            LazyVGrid(columns: searchGridColumns, spacing: 14) {
                ForEach(0 ..< 9, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        ShimmerView(cornerRadius: 10)
                            .aspectRatio(2.0 / 3.0, contentMode: .fit)
                        ShimmerView(cornerRadius: 4).frame(height: 12)
                    }
                }
            }
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
        } else if let searchError {
            ContentUnavailableView(
                "Search failed",
                systemImage: "wifi.slash",
                description: Text(searchError)
            )
            .padding(.top, 16)
        } else if searchResults.isEmpty, bookResults.isEmpty {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "magnifyingglass",
                description: Text("Try a different title.")
            )
            .padding(.top, 28)
        } else {
            VStack(alignment: .leading, spacing: 20) {
                if !bookResults.isEmpty {
                    Text("Books")
                        .font(.sectionTitle)
                        .foregroundStyle(Theme.textStrong)
                        .padding(.horizontal, 16)
                    ForEach(bookResults) { hit in
                        bookSearchRow(hit)
                            .padding(.horizontal, 16)
                    }
                }
                if !searchResults.isEmpty {
                    if !bookResults.isEmpty {
                        Text("Movies & TV")
                            .font(.sectionTitle)
                            .foregroundStyle(Theme.textStrong)
                            .padding(.horizontal, 16)
                    }
                    LazyVGrid(columns: searchGridColumns, spacing: 14) {
                        ForEach(searchResults) { item in
                            let zoomID = RawkoonZoom.media(tmdbId: item.tmdbId, mediaType: item.mediaType)
                            NavigationLink {
                                MediaDetailView(
                                    tmdbId: item.tmdbId,
                                    mediaType: item.mediaType,
                                    title: item.title,
                                    posterPath: item.posterUrl,
                                    libraryId: item.libraryId
                                )
                                .navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))
                            } label: {
                                posterCard(item, fixedWidth: nil)
                                    .matchedTransitionSource(id: zoomID, in: zoomNamespace)
                            }
                            .buttonStyle(.plain)
                            .rawkoonScrollSettle()
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
    }

    @ViewBuilder
    private func bookSearchRow(_ hit: BookSearchHit) -> some View {
        let inLibraryBook = hit.libraryBookId.flatMap { id in
            model.library.first { $0.bookId == id }
        }
        HStack(spacing: 12) {
            if let book = inLibraryBook {
                NavigationLink {
                    BookView(book: book)
                } label: {
                    bookSearchLabel(hit)
                }
                .buttonStyle(.plain)
            } else {
                bookSearchLabel(hit)
            }

            if hit.inLibrary {
                StatusBadge(text: "In library", tint: Theme.seed)
            } else if model.isAdmin {
                Button {
                    Task { await addBook(hit) }
                } label: {
                    if addingVolumeId == hit.googleVolumeId {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text("Add")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .padding(.horizontal, 12)
                .background(Theme.terracotta, in: Capsule())
                .foregroundStyle(Theme.onAccent)
                .disabled(addingVolumeId != nil)
            } else {
                Button {
                    Task { await requestBook(hit) }
                } label: {
                    if requestingVolumeId == hit.googleVolumeId {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text("Request")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .padding(.horizontal, 12)
                .background(Theme.terracotta, in: Capsule())
                .foregroundStyle(Theme.onAccent)
                .disabled(requestingVolumeId != nil)
            }
        }
    }

    private func bookSearchLabel(_ hit: BookSearchHit) -> some View {
        HStack(spacing: 12) {
            BookCover(url: model.absoluteURL(hit.coverUrl), size: 56, corner: 10)
            VStack(alignment: .leading, spacing: 4) {
                Text(hit.title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                if !hit.authors.isEmpty {
                    Text(hit.authors.joined(separator: ", "))
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                if let year = hit.publishedYear {
                    Text(String(year))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
            Spacer(minLength: 8)
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: Poster card

    /// A 2:3 poster with a status chip, plus a title caption below the image.
    /// Pass `fixedWidth` for a known point size; pass nil inside the search
    /// grid, where the LazyVGrid column already constrains the width and the
    /// view simply fills it while keeping the 2:3 ratio.
    @ViewBuilder
    private func posterCard(_ item: TmdbSearchItem, fixedWidth: CGFloat?) -> some View {
        let image = CachedAsyncImage(url: model.absoluteURL(item.posterUrl), targetSize: CGSize(width: 160, height: 240)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Theme.raised
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .topTrailing) {
            statusChip(item)
                .padding(6)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.06), lineWidth: 1)
        )

        VStack(alignment: .leading, spacing: 6) {
            if let fixedWidth {
                image.frame(width: fixedWidth, height: fixedWidth * 1.5)
            } else {
                image.aspectRatio(2.0 / 3.0, contentMode: .fit)
            }

            Text(item.title)
                .font(.caption)
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(minHeight: captionMinHeight, alignment: .top)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(width: fixedWidth)
    }

    @ViewBuilder
    private func statusChip(_ item: TmdbSearchItem) -> some View {
        if item.alreadyExists == true {
            Image(systemName: "checkmark")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color(hex: 0x10231A))
                .frame(width: 22, height: 22)
                .background(Theme.seed, in: Circle())
                .accessibilityLabel("In library")
        }
    }

    // MARK: Search data

    private func runSearch(query: String, kind: KindFilter) async {
        loadingSearch = true
        searchError = nil
        defer { loadingSearch = false }

        guard let client = model.api() else {
            searchError = String(localized: "Not signed in.")
            return
        }

        var tmdb: [TmdbSearchItem] = []
        var books: [BookSearchHit] = []
        var firstError: String?

        if kind.includesMoviesAndTV {
            do {
                tmdb = try await client.tmdbSearch(q: query, kind: kind.apiValue).items
            } catch let error as APIError {
                firstError = message(for: error)
            } catch {
                firstError = String(localized: "Network error. Check your connection.")
            }
            guard !Task.isCancelled else { return }
        }

        if kind.includesBooks {
            do {
                books = try await client.bookSearch(q: query).results
            } catch let error as APIError {
                if firstError == nil {
                    firstError = message(for: error)
                }
            } catch {
                if firstError == nil {
                    firstError = String(localized: "Network error. Check your connection.")
                }
            }
            guard !Task.isCancelled else { return }
        }

        searchResults = tmdb
        bookResults = books
        if tmdb.isEmpty, books.isEmpty {
            searchError = firstError
        } else {
            searchError = nil
        }
    }

    private func addBook(_ hit: BookSearchHit) async {
        guard let client = model.api() else { return }
        addingVolumeId = hit.googleVolumeId
        defer { addingVolumeId = nil }
        do {
            try await client.addBook(googleVolumeId: hit.googleVolumeId)
            await model.loadLibrary()
            await runSearch(query: trimmedQuery, kind: kindFilter)
        } catch {
            searchError = String(localized: "Could not add that book.")
        }
    }

    private func requestBook(_ hit: BookSearchHit) async {
        guard let client = model.api() else { return }
        requestingVolumeId = hit.googleVolumeId
        defer { requestingVolumeId = nil }
        do {
            _ = try await client.createRequest(CreateRequestBody(
                tmdbId: nil,
                type: "book",
                title: hit.title,
                posterUrl: hit.coverUrl,
                year: hit.publishedYear,
                googleVolumeId: hit.googleVolumeId,
                author: hit.authors.isEmpty ? nil : hit.authors.joined(separator: ", ")
            ))
            model.toast(String(localized: "Requested — we'll notify you"), style: .success)
        } catch let error as APIError {
            model.toast(message(for: error), style: .error)
        } catch {
            model.toast(String(localized: "Network error. Check your connection."), style: .error)
        }
    }

    private func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}
