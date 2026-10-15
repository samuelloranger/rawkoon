import Foundation
@testable import Rawkoon
import Testing

struct BookRequestModelsTests {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try APIClient.mediaDecoder.decode(T.self, from: Data(json.utf8))
    }

    private let hit = """
    {"google_volume_id": "vol1", "title": "T", "subtitle": null, "authors": ["A"],
     "published_year": 2020, "cover_url": null, "overview": null,
     "in_library": false, "library_book_id": null
    """

    @Test func searchHitDecodesRequestState() throws {
        let response: BookSearchResponse = try decode(
            "{\"results\": [\(hit), \"request\": {\"id\": 12, \"status\": \"pending\"}}]}"
        )
        #expect(response.results.first?.request == BookRequestState(id: 12, status: "pending"))
    }

    @Test func searchHitDecodesNullRequest() throws {
        let response: BookSearchResponse = try decode("{\"results\": [\(hit), \"request\": null}]}")
        #expect(response.results.first?.request == nil)
    }

    @Test func searchHitToleratesOlderServers() throws {
        let response: BookSearchResponse = try decode("{\"results\": [\(hit)}]}")
        #expect(response.results.count == 1)
        #expect(response.results.first?.request == nil)
    }

    @Test func discoveryBookDecodesWithAndWithoutRequest() throws {
        let base = """
        "rank": 1, "title": "T", "isbn13": null, "cover_url": null, "source_url": null,
        "author": null, "overview": null, "published_year": null, "volume_id": "v",
        "already_in_library": false
        """
        let with: BookDiscoveryBook = try decode("{\(base), \"request\": {\"id\": 3, \"status\": \"denied\"}}")
        #expect(with.request?.canRequestAgain == true)
        let without: BookDiscoveryBook = try decode("{\(base)}")
        #expect(without.request == nil)
    }

    @Test func onlyDeniedCanBeRequestedAgain() {
        for status in ["pending", "approved", "available"] {
            #expect(BookRequestState(id: 1, status: status).canRequestAgain == false)
        }
    }
}
