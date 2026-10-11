import Foundation
@testable import Rawkoon
import Testing

/// Protects the wire-to-row contract used by ReleaseSearchView before its state
/// and rendering move into separate files.
struct ReleaseSearchRegressionTests {
    @Test @MainActor func decodedSearchResultsKeepGrabTargetsAndQualityOrder() throws {
        let payload = """
        {
          "success": true,
          "service": "Prowlarr",
          "releases": [
            {
              "guid": "rejected",
              "title": "Dune 2021 2160p",
              "indexer": "Tracker A",
              "languages": ["English"],
              "quality_score": 99,
              "rejected": true,
              "download_url": "https://example.test/rejected.torrent"
            },
            {
              "guid": "accepted",
              "title": "Dune 2021 1080p",
              "indexer": "Tracker B",
              "languages": ["French"],
              "quality_score": 80,
              "rejected": false,
              "download_url": "https://example.test/accepted.torrent",
              "download_token": "fallback-token",
              "is_season_pack": true,
              "parsed_quality": { "resolution": 1080, "source": "web", "codec": "h265", "hdr": null }
            },
            {
              "guid": "unscored",
              "title": "Dune 2021",
              "indexer": null,
              "languages": [],
              "quality_score": null,
              "rejected": null,
              "download_token": "token-only"
            }
          ],
          "indexer_warnings": [{ "id": "slow", "name": "Tracker C", "error": "Timed out" }]
        }
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(InteractiveSearchResponse.self, from: Data(payload.utf8))

        #expect(response.service == "Prowlarr")
        #expect(response.indexerWarnings?.map(\.id) == ["slow"])
        let accepted = try #require(response.releases.first { $0.guid == "accepted" })
        #expect(accepted.downloadUrl == "https://example.test/accepted.torrent")
        #expect(accepted.downloadToken == "fallback-token")
        #expect(accepted.isSeasonPack == true)
        #expect(accepted.parsedQuality?.resolution == 1080)
        #expect(response.releases.first { $0.guid == "unscored" }?.downloadToken == "token-only")

        let session = ReleaseSearchSession(
            query: "Dune", libraryMediaId: 42, tmdbId: nil, mediaType: "movie",
            availableSeasons: [], mediaYear: 2021, originalTitle: nil,
            originalLanguage: nil, titleTranslations: [], targetSeason: nil,
            targetEpisode: nil, isUpgrade: false
        )
        session.releases = response.releases
        let filters = ReleaseSearchFilters(libraryMediaId: 42)
        #expect(filters.sortedReleases(in: session).map(\.guid) == ["accepted", "unscored"])

        filters.showPacksOnly = true
        #expect(filters.filteredReleases(in: session).map(\.guid) == ["accepted"])

        filters.showPacksOnly = false
        filters.includedTrackers = ["tracker b"]
        #expect(filters.filteredReleases(in: session).map(\.guid) == ["accepted"])

        session.searchQuery = "User query"
        session.updateInputs(ReleaseSearchInputs(
            query: "Dune refreshed", libraryMediaId: 42, tmdbId: 12, mediaType: "tv",
            availableSeasons: [3, 0, 1], mediaYear: 2022,
            originalTitle: "Le désert", originalLanguage: "fr",
            titleTranslations: [.init(languageCode: "fr", title: "Le désert")],
            targetSeason: 3, targetEpisode: 2, isUpgrade: true
        ))
        #expect(session.searchQuery == "User query")
        #expect(session.availableSeasons == [1, 3])
        #expect(session.titleOptions.contains { $0.query == "Le désert" })
        #expect(session.targetSeason == 3)
        #expect(session.targetEpisode == 2)
        #expect(session.isUpgrade)
    }
}
