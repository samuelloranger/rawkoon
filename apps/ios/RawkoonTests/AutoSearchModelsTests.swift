import Foundation
@testable import Rawkoon
import Testing

/// Same shape as the item envelope the library routes return.
private struct ItemEnvelope: Decodable {
    let item: LibraryMedia
}

struct AutoSearchModelsTests {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try APIClient.mediaDecoder.decode(T.self, from: Data(json.utf8))
    }

    @Test func searchResponseDecodesAiPick() throws {
        let picked: LibrarySearchResponse = try decode(
            #"{"grabbed": true, "release_title": "Some.Release.1080p", "ai_picked": true}"#
        )
        #expect(picked.grabbed)
        #expect(picked.releaseTitle == "Some.Release.1080p")
        #expect(picked.aiPicked == true)
    }

    @Test func searchResponseToleratesOlderServers() throws {
        let miss: LibrarySearchResponse = try decode(#"{"grabbed": false, "reason": "No matching releases found"}"#)
        #expect(miss.aiPicked == nil)
        #expect(miss.reason == "No matching releases found")
    }

    @Test func profileUpdateDecodesNeedsUpgrade() throws {
        let response: ItemEnvelope = try decode("""
        {"item": {"id": 4, "tmdb_id": 9, "type": "show", "title": "A Show", "year": 2020,
          "status": "downloaded", "monitored": true, "needs_upgrade": true, "affected_episodes": 3}}
        """)
        #expect(response.item.needsUpgrade == true)
        #expect(response.item.affectedEpisodes == 3)
    }

    @Test func plainItemHasNoUpgradeFlag() throws {
        let response: ItemEnvelope = try decode("""
        {"item": {"id": 4, "tmdb_id": 9, "type": "movie", "title": "A Movie", "year": 2020,
          "status": "wanted", "monitored": true}}
        """)
        #expect(response.item.needsUpgrade == nil)
        #expect(response.item.affectedEpisodes == nil)
    }
}
