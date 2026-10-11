import Foundation
import Observation
import RawkoonKit

/// Media-lane state and actions. ServerStateStore remains the source of truth for rows.
@MainActor
@Observable
final class LibraryMediaModel {
    private struct SavedPages {
        let items: [LibraryMedia]
        let pages: Int
        let hasMore: Bool
    }

    var mediaType: MediaTypeFilter = .all
    var mediaStatus: MediaStatusFilter = .all
    var sort: MediaSort = .added_at
    var sortAscending = false
    var mediaSearch = ""
    var releaseSearch: ReleaseSearchPresentation?
    var removeCandidate: LibraryMedia?
    var showingRemoveConfirm = false
    var menuDetailMedia: LibraryMedia?
    var busyMediaIds: Set<Int> = []
    @ObservationIgnored var liveReloadTask: Task<Void, Never>?

    var filterKey: String {
        "\(mediaType.rawValue)|\(mediaStatus.rawValue)|\(sort.rawValue)|\(sortAscending)|\(normalizedSearch)"
    }

    private var normalizedSearch: String {
        mediaSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var key: LibraryListKey {
        LibraryListKey(
            type: mediaType.param, status: mediaStatus.param,
            query: normalizedSearch.isEmpty ? nil : normalizedSearch,
            page: 1, limit: 60, sortBy: sort.rawValue,
            sortDirection: sortAscending ? "asc" : "desc"
        )
    }

    func media(in model: AppModel) -> [LibraryMedia] {
        model.serverStateStore.libraryList(key).value ?? []
    }

    func error(in model: AppModel) -> String? {
        model.serverStateStore.libraryList(key).errorDescription
    }

    func isLoading(in model: AppModel) -> Bool {
        model.serverStateStore.libraryList(key).isLoading
    }

    func isLoadingMore(in model: AppModel) -> Bool {
        model.serverStateStore.pagination(key).isLoadingMore
    }

    func hasMore(in model: AppModel) -> Bool {
        model.serverStateStore.pagination(key).hasMore
    }

    func animationToken(for media: [LibraryMedia]) -> Int {
        var hasher = Hasher()
        for item in media {
            hasher.combine(item.id)
            hasher.combine(item.monitored)
            hasher.combine(item.isProvisional)
            hasher.combine(item.status)
            hasher.combine(busyMediaIds.contains(item.id))
        }
        return hasher.finalize()
    }

    /// Reloads the full visible window instead of collapsing a scrolled list to page one.
    func load(reset: Bool, model: AppModel) async {
        if applyOfflineSearch(model: model) {
            return
        }
        guard let client = model.api() else { return }
        let currentKey = key
        let loader = pageLoader(for: currentKey, client: client)
        do {
            if reset {
                try await model.serverStateStore.refreshLibraryWindow(currentKey, loader: loader)
            } else {
                try await model.serverStateStore.loadNextLibraryPage(currentKey, loader: loader)
            }
        } catch {
            // The store publishes failure while preserving the visible rows.
        }
    }

    func hydrateFromCache(model: AppModel) {
        let currentKey = key
        let store = model.serverStateStore
        guard let client = model.api(), store.libraryList(currentKey).value == nil else { return }
        if let saved = savedPages(for: currentKey, client: client) {
            store.hydrateLibraryList(
                currentKey, items: saved.items, pagesLoaded: saved.pages, hasMore: saved.hasMore
            )
        }
    }

    private func applyOfflineSearch(model: AppModel) -> Bool {
        let currentKey = key
        guard model.isOffline, let query = currentKey.query, !query.isEmpty,
              let client = model.api() else { return false }
        let base = LibraryListKey(
            type: currentKey.type, status: currentKey.status, query: nil, page: currentKey.page,
            limit: currentKey.limit, sortBy: currentKey.sortBy, sortDirection: currentKey.sortDirection
        )
        let store = model.serverStateStore
        let source = store.libraryList(base).value ?? savedPages(for: base, client: client)?.items ?? []
        let matches = source.filter { $0.title.localizedStandardContains(query) }
        store.seedLibraryList(matches, for: currentKey, pagesLoaded: 1, hasMore: false)
        return true
    }

    private func savedPages(
        for key: LibraryListKey, client: APIClient
    ) -> SavedPages? {
        var items: [LibraryMedia] = []
        var pages = 0
        var hasMore = false
        while let cached = client.cached(Endpoints.libraryList(
            type: key.type, status: key.status, q: key.query, page: pages + 1,
            limit: key.limit, sortBy: key.sortBy ?? "added_at",
            sortDir: key.sortDirection ?? "desc"
        )) {
            for item in cached.value.items where !items.contains(where: { $0.id == item.id }) {
                items.append(item)
            }
            pages += 1
            hasMore = cached.value.hasMore == true
            if !hasMore {
                break
            }
        }
        return pages > 0 ? SavedPages(items: items, pages: pages, hasMore: hasMore) : nil
    }

    private func pageLoader(
        for key: LibraryListKey, client: APIClient
    ) -> @Sendable (Int) async throws -> LibraryPage {
        { page in
            do {
                let response = try await client.libraryList(
                    type: key.type, status: key.status, q: key.query, page: page,
                    limit: key.limit, sortBy: key.sortBy ?? "added_at",
                    sortDir: key.sortDirection ?? "desc"
                )
                return LibraryPage(items: response.items, hasMore: response.hasMore == true)
            } catch {
                throw LibraryLoadError(message: libraryErrorMessage(for: error))
            }
        }
    }

    func loadMoreIfNeeded(model: AppModel) {
        guard hasMore(in: model), !isLoadingMore(in: model), !isLoading(in: model),
              error(in: model) == nil else { return }
        Task { await load(reset: false, model: model) }
    }

    func reloadLoadedWindow(model: AppModel) async {
        await load(reset: true, model: model)
    }

    func handleMenu(_ action: MediaPosterMenuAction, media: LibraryMedia, model: AppModel) {
        guard LibraryRowPresentation(media: media).isInteractive,
              !(action.requiresConnection && model.isOffline) else { return }
        switch action {
        case .toggleMonitored:
            Task { await toggleMonitored(media, model: model) }
        case .autoSearch:
            Task { await autoSearch(media, model: model) }
        case .searchReleases:
            releaseSearch = presentation(for: media)
        case .openDetails:
            menuDetailMedia = media
        case .removeFromLibrary:
            removeCandidate = media
            showingRemoveConfirm = true
        }
    }

    private func presentation(for media: LibraryMedia) -> ReleaseSearchPresentation {
        ReleaseSearchPresentation(
            query: media.title, libraryMediaId: media.id, tmdbId: media.tmdbId,
            mediaType: media.type == "show" ? "tv" : "movie"
        )
    }

    private func autoSearch(_ media: LibraryMedia, model: AppModel) async {
        guard !busyMediaIds.contains(media.id) else { return }
        busyMediaIds.insert(media.id)
        defer { busyMediaIds.remove(media.id) }
        model.toast(String(localized: "Searching for a release…"), style: .info)
        let grabbed = await model.autoSearchMovie(libraryId: media.id) {
            self.releaseSearch = self.presentation(for: media)
        }
        if grabbed {
            await reloadLoadedWindow(model: model)
        }
    }

    private func toggleMonitored(_ media: LibraryMedia, model: AppModel) async {
        guard let client = model.api(), !busyMediaIds.contains(media.id) else { return }
        busyMediaIds.insert(media.id)
        do {
            _ = try await model.serverStateStore.updateMonitored(
                id: media.id, monitored: !media.monitored,
                request: { try await client.updateLibraryMonitored(id: media.id, monitored: !media.monitored) }
            )
            model.toast(
                media.monitored ? String(localized: "Unmonitored.") : String(localized: "Monitored."),
                style: .success
            )
        } catch {
            model.toast(libraryErrorMessage(for: error), style: .error)
        }
        busyMediaIds.remove(media.id)
    }

    func removeFromLibrary(_ media: LibraryMedia, deleteFiles: Bool, model: AppModel) async {
        guard let client = model.api() else { return }
        busyMediaIds.insert(media.id)
        do {
            try await model.serverStateStore.removeLibraryItem(
                id: media.id,
                request: { try await client.removeFromLibrary(id: media.id, deleteFiles: deleteFiles) }
            )
            removeCandidate = nil
            model.toast(String(localized: "Removed from library."), style: .success)
            if self.media(in: model).isEmpty, hasMore(in: model) {
                await load(reset: true, model: model)
            }
        } catch {
            model.toast(libraryErrorMessage(for: error), style: .error)
        }
        busyMediaIds.remove(media.id)
    }
}
