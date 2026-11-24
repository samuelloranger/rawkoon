import RawkoonKit
import SwiftUI

/// A TMDB title to add or request, whichever screen it came from.
struct TitlePick {
    let tmdbId: Int
    let mediaType: String
    let title: String
    let year: Int?
    let posterUrl: String?
    let overview: String?

    init(tmdbId: Int, mediaType: String, title: String, year: Int?, posterUrl: String?, overview: String?) {
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.title = title
        self.year = year
        self.posterUrl = posterUrl
        self.overview = overview
    }

    init(_ item: DiscoverDeckItem) {
        tmdbId = item.tmdbId
        mediaType = item.mediaType
        title = item.title
        year = item.releaseYear
        posterUrl = item.posterUrl
        overview = item.overview
    }

    init(_ item: TmdbSearchItem) {
        tmdbId = item.tmdbId
        mediaType = item.mediaType
        title = item.title
        year = item.releaseYear
        posterUrl = item.posterUrl
        overview = item.overview
    }
}

extension AppModel {
    /// Adds a discover pick: admins put it straight in the library, everyone else files a request.
    func addDiscoverPick(_ item: DiscoverDeckItem) async throws {
        try await addPick(TitlePick(item), compact: true)
    }

    /// Admins add straight to the library (live toast included); everyone else files a request.
    /// Returns the library item for an admin add.
    @discardableResult
    func addPick(_ pick: TitlePick, mode: AddMode = .standard, compact: Bool = false) async throws -> LibraryMedia? {
        guard let client = api() else { throw URLError(.notConnectedToInternet) }
        // An explicit long-press mode already says how to add, so only the plain tap asks.
        let choice = mode == .standard ? try await chooseAdd(AddSubject(pick), compact: compact) : nil
        let type = pick.mediaType == "tv" ? "show" : "movie"
        var added: LibraryMedia?
        if isAdmin {
            let item = try await addTitleToLibrary(
                provisional: .provisional(
                    tmdbId: pick.tmdbId,
                    type: type,
                    title: pick.title,
                    year: pick.year,
                    posterUrl: pick.posterUrl,
                    overview: pick.overview
                ),
                tmdbId: pick.tmdbId,
                type: type,
                title: pick.title,
                searchOnAdd: mode.searchOnAdd,
                announce: !mode.opensReleaseSheet,
                choice: choice
            )
            added = item
            await libraryStore.loadLibrary()
            if mode.opensReleaseSheet {
                liveSearch.openReleaseSheet(mediaId: item.id)
            }
        } else {
            _ = try await client.createRequest(CreateRequestBody(
                tmdbId: pick.tmdbId,
                type: type,
                title: pick.title,
                posterUrl: pick.posterUrl,
                year: pick.year,
                googleVolumeId: nil,
                author: nil,
                seasonMode: choice?.season?.mode.rawValue,
                seasons: choice?.season?.seasonsPayload
            ))
            toast(String(localized: "Requested \(pick.title)"), style: .success)
        }
        requestPushAuthorization()
        return added
    }
}
