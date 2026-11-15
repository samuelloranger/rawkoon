import RawkoonKit
import SwiftUI

/// Find's answers to one query, in three groups: your library, TMDB titles, then books.
struct FindSearchResults: View {
    @Environment(AppModel.self) private var model

    let query: String

    @State private var libraryResults: QuickSearchResponse?
    @State private var searchResults: [TmdbSearchItem] = []
    @State private var bookResults: [BookSearchHit] = []
    @State private var loadingSearch = false
    /// Bumped per search, so a slower, superseded one can't clear the loading flag of the newer one.
    @State private var searchGeneration = 0
    @State private var searchError: String?
    @State private var addingVolumeId: String?
    @State private var requestingVolumeId: String?
    /// Movie/show results being added or requested, added this session (with their library id), requested this session.
    @State private var addingTitleIds: Set<String> = []
    @State private var addedLibraryIds: [String: Int] = [:]
    @State private var addedTitleIds: Set<String> = []
    @State private var requestedTitleIds: Set<String> = []
    /// Volumes requested this session, so the row flips before (or without) a server echo.
    @State private var requestedVolumeIds: Set<String> = []
    /// What the results on screen were searched for.
    @State private var resultsKey: String?

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The task key: the connection is part of it so the search runs again once it's back.
    private struct SearchTrigger: Equatable {
        let query: String
        let offline: Bool
        let booksEnabled: Bool
    }

    private var libraryMedias: [QuickSearchMedia] {
        libraryResults?.medias ?? []
    }

    private var libraryBooks: [QuickSearchBook] {
        model.booksEnabled ? libraryResults?.books ?? [] : []
    }

    private var hasLibraryHits: Bool {
        !libraryMedias.isEmpty || !libraryBooks.isEmpty
    }

    /// The answer for this query hasn't arrived: still in the debounce, or searching with nothing else to show.
    private var showsSkeleton: Bool {
        !model.isOffline && resultsKey != trimmedQuery && (loadingSearch || hasNoResults)
    }

    private var hasNoResults: Bool {
        !hasLibraryHits && searchResults.isEmpty && bookResults.isEmpty
    }

    var body: some View {
        searchContent
            .rawkoonMotion(RawkoonMotion.spring, value: loadingSearch)
            // Debounced; a new key cancels the pending search before it runs.
            .task(id: SearchTrigger(query: trimmedQuery, offline: model.isOffline, booksEnabled: model.booksEnabled)) {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                await runSearch(query: trimmedQuery)
            }
    }

    // MARK: Search results

    @ViewBuilder
    private var searchContent: some View {
        if showsSkeleton {
            VStack(spacing: 10) {
                ForEach(0 ..< 5, id: \.self) { _ in
                    ShimmerView(cornerRadius: 14).frame(height: 120)
                }
            }
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
            .transition(.rawkoonSwap)
        } else if model.isOffline, hasNoResults {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("Search needs a connection.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if let searchError, hasNoResults {
            ContentUnavailableView(
                "Search failed",
                systemImage: "wifi.slash",
                description: Text(searchError)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if hasNoResults {
            ContentUnavailableView(
                "Nothing to show yet",
                systemImage: "magnifyingglass",
                description: Text("Try a different title.")
            )
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(FindResultGroup.visible(booksEnabled: model.booksEnabled), id: \.self) { group in
                    groupSection(group)
                }
            }
            .transition(.rawkoonSwap)
        }
    }

    @ViewBuilder
    private func groupSection(_ group: FindResultGroup) -> some View {
        switch group {
        case .library where hasLibraryHits:
            sectionHeader("In your library")
            VStack(spacing: 10) {
                ForEach(libraryMedias) { media in
                    libraryRow(
                        title: media.title,
                        detail: libraryDetail(media),
                        systemImage: media.type == "show" ? "tv" : "film",
                        destination: .media(libraryId: media.id, season: nil, episode: nil, focusManagement: false)
                    )
                }
                ForEach(libraryBooks) { book in
                    libraryRow(
                        title: book.title,
                        detail: book.authors.joined(separator: ", "),
                        systemImage: "book",
                        destination: .book(bookId: book.id)
                    )
                }
            }
            .padding(.horizontal, 16)
        case .titles where !searchResults.isEmpty:
            sectionHeader("Titles")
            LazyVStack(spacing: 10) {
                ForEach(searchResults) { item in
                    SearchTitleRow(
                        item: item,
                        action: resultAction(for: item),
                        busy: addingTitleIds.contains(item.id),
                        libraryId: addedLibraryIds[item.id],
                        onAdd: { mode in Task { await addTitle(item, mode: mode) } }
                    )
                    .rawkoonEntrance(id: item.id)
                }
            }
            .padding(.horizontal, 16)
            .rawkoonEntranceScope()
        case .books where !bookResults.isEmpty:
            sectionHeader("Books")
            ForEach(bookResults) { hit in
                bookSearchRow(hit)
                    .padding(.horizontal, 16)
            }
        default:
            EmptyView()
        }
    }

    private func sectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.sectionTitle)
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 16)
    }

    private func libraryDetail(_ media: QuickSearchMedia) -> String {
        let kind = media.type == "show" ? String(localized: "Show") : String(localized: "Movie")
        guard let year = media.year else { return kind }
        return "\(year) \u{00B7} \(kind)"
    }

    private func libraryRow(
        title: String, detail: String, systemImage: String, destination: NotificationDestination
    ) -> some View {
        NavigationLink {
            NotificationDestinationView(destination: destination)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: title)
                        .font(.display(16))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    if !detail.isEmpty {
                        Text(verbatim: detail)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.faint)
            }
            .padding(12)
            .frame(minHeight: 56)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.rawkoonPressable(scale: 0.98))
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
                .buttonStyle(.rawkoonPressable(scale: 0.98))
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
                .requiresConnection(model.isOffline)
            } else if requestedVolumeIds.contains(hit.googleVolumeId) || hit.request.map({ !$0.canRequestAgain }) == true {
                bookRequestBadge(status: hit.request?.status ?? "pending")
            } else {
                Button {
                    Task { await requestBook(hit) }
                } label: {
                    if requestingVolumeId == hit.googleVolumeId {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text(hit.request == nil ? LocalizedStringKey("Request") : LocalizedStringKey("Request again"))
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .padding(.horizontal, 12)
                .background(Theme.terracotta, in: Capsule())
                .foregroundStyle(Theme.onAccent)
                .disabled(requestingVolumeId != nil)
                .requiresConnection(model.isOffline)
            }
        }
    }

    /// A member's request that is already in flight; approved/available show as such.
    @ViewBuilder
    private func bookRequestBadge(status: String) -> some View {
        switch status {
        case "approved":
            StatusBadge(text: "Approved", tint: Theme.seed)
        case "available":
            StatusBadge(text: "Available", tint: Theme.seed)
        default:
            StatusBadge(text: "Requested")
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

    // MARK: Search data

    private func runSearch(query: String) async {
        // Searching offline would only fail; results for another query go.
        guard !model.isOffline else {
            if resultsKey != query {
                libraryResults = nil
                searchResults = []
                bookResults = []
                resultsKey = nil
            }
            searchError = nil
            return
        }
        searchGeneration += 1
        let generation = searchGeneration
        loadingSearch = true
        searchError = nil
        defer {
            if generation == searchGeneration {
                loadingSearch = false
            }
        }

        guard let client = model.api() else {
            searchError = String(localized: "Not signed in.")
            return
        }

        let withBooks = model.booksEnabled
        async let library = Self.attempt { try await client.quickSearch(q: query) }
        async let titles = Self.attempt { try await client.tmdbSearch(q: query).items }
        async let books: Attempt<[BookSearchHit]> = withBooks
            ? Self.attempt { try await client.bookSearch(q: query).results }
            : Attempt(value: [], error: nil)
        let (libraryOutcome, titlesOutcome, booksOutcome) = await (library, titles, books)
        guard !Task.isCancelled else { return }

        libraryResults = libraryOutcome.value
        searchResults = titlesOutcome.value ?? []
        bookResults = booksOutcome.value ?? []
        resultsKey = query
        // Only a search that found nothing reports why; a partial answer still shows.
        searchError = hasNoResults
            ? [libraryOutcome.error, titlesOutcome.error, booksOutcome.error].compactMap(\.self).first
            : nil
    }

    /// One group's outcome, so a failing group never blanks the others.
    private nonisolated struct Attempt<Value: Sendable>: Sendable {
        let value: Value?
        let error: String?
    }

    private nonisolated static func attempt<Value: Sendable>(
        _ work: @Sendable () async throws -> Value
    ) async -> Attempt<Value> {
        do {
            return try await Attempt(value: work(), error: nil)
        } catch let error as APIError {
            return Attempt(value: nil, error: error.userMessage(unauthorized: String(localized: "Sign in required.")))
        } catch {
            return Attempt(value: nil, error: String(localized: "Can't reach the server. Try again in a moment."))
        }
    }

    private func resultAction(for item: TmdbSearchItem) -> SearchResultAction {
        .resolve(
            inLibrary: item.alreadyExists == true,
            canAdd: item.canAdd ?? true,
            isAdmin: model.isAdmin,
            addedHere: addedTitleIds.contains(item.id),
            requestedHere: requestedTitleIds.contains(item.id)
        )
    }

    private func addTitle(_ item: TmdbSearchItem, mode: AddMode) async {
        guard addingTitleIds.insert(item.id).inserted else { return }
        defer { addingTitleIds.remove(item.id) }
        do {
            let added = try await model.addPick(TitlePick(item), mode: mode)
            markDone(item, library: added?.id)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            // 409: it is already added or requested, so show that state.
            if error.isConflict {
                markDone(item, library: nil)
            } else {
                model.toast(message(for: error), style: .error)
            }
        } catch {
            model.toast(String(localized: "Can't reach the server. Try again in a moment."), style: .error)
        }
    }

    private func markDone(_ item: TmdbSearchItem, library: Int?) {
        if model.isAdmin {
            addedTitleIds.insert(item.id)
            addedLibraryIds[item.id] = library
        } else {
            requestedTitleIds.insert(item.id)
        }
    }

    private func addBook(_ hit: BookSearchHit) async {
        guard let client = model.api() else { return }
        addingVolumeId = hit.googleVolumeId
        defer { addingVolumeId = nil }
        do {
            let choice = try await model.chooseAdd(AddSubject(
                bookTitle: hit.title, author: hit.authors.isEmpty ? nil : hit.authors.joined(separator: ", "),
                year: hit.publishedYear, coverUrl: hit.coverUrl
            ))
            try await client.addBook(googleVolumeId: hit.googleVolumeId, choice: choice)
            model.requestPushAuthorization()
            await model.loadLibrary()
            await runSearch(query: trimmedQuery)
        } catch is CancellationError {
            return
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
            requestedVolumeIds.insert(hit.googleVolumeId)
            model.toast(String(localized: "Requested — we'll notify you"), style: .success)
            model.requestPushAuthorization()
            await runSearch(query: trimmedQuery)
        } catch let error as APIError {
            model.toast(message(for: error), style: .error)
            // 409: someone already requested or added it, so pick up the real state.
            if case let .server(status, _) = error, status == 409 {
                await runSearch(query: trimmedQuery)
            }
        } catch {
            model.toast(String(localized: "Can't reach the server. Try again in a moment."), style: .error)
        }
    }

    private func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}
