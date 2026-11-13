import Foundation
@testable import Rawkoon
import Testing

/// The shelf shapes as the routes answer them, including the three cover styles.
struct ShelfModelsTests {
    private func decode(_ json: String) throws -> ShelfDetail {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(ShelfDetail.self, from: Data(json.utf8))
    }

    @Test func anUploadedCoverCarriesItsImageURL() throws {
        let shelf = try decode(
            """
            {"id": 1, "name": "Christmas", "description": null,
             "cover": {"style": "upload", "url": "http://box.local/api/shelves/covers/cover-1.png"},
             "entry_count": 3, "in_library_count": 1, "home_row": true, "visible_now": true,
             "order_mode": "manual", "visible_from": null, "visible_to": null,
             "cover_tmdb_id": null, "cover_type": null, "seed_key": null, "entries": []}
            """
        )
        #expect(shelf.cover == .upload(url: "http://box.local/api/shelves/covers/cover-1.png"))
        #expect(shelf.cover.style == "upload")
    }

    @Test func aPickedBackdropKeepsItsURL() throws {
        let shelf = try decode(
            """
            {"id": 2, "name": "Bond", "description": null,
             "cover": {"style": "backdrop", "backdrop_url": "https://image.tmdb.org/t/p/w1280/b.jpg"},
             "entry_count": 0, "in_library_count": 0, "home_row": false, "visible_now": true,
             "order_mode": "release", "visible_from": null, "visible_to": null,
             "cover_tmdb_id": 645, "cover_type": "movie", "seed_key": "bond", "entries": []}
            """
        )
        #expect(shelf.cover == .backdrop(url: "https://image.tmdb.org/t/p/w1280/b.jpg"))
        #expect(shelf.orderMode == .release)
        #expect(shelf.coverTmdbId == 645)
    }

    @Test func aMosaicKeepsItsPosters() throws {
        let shelf = try decode(
            """
            {"id": 3, "name": "Pixar", "description": null,
             "cover": {"style": "mosaic", "posters": ["a.jpg", "b.jpg"]},
             "entry_count": 2, "in_library_count": 0, "home_row": false, "visible_now": true,
             "order_mode": "added", "visible_from": "11-01", "visible_to": "01-15",
             "cover_tmdb_id": null, "cover_type": null, "seed_key": null, "entries": []}
            """
        )
        #expect(shelf.cover == .mosaic(posters: ["a.jpg", "b.jpg"]))
        #expect(shelf.visibleFrom == "11-01")
        #expect(shelf.orderMode == .added)
    }

    @Test func clearedFieldsGoOutAsExplicitNulls() throws {
        let body = UpdateShelfBody(
            name: "Bond", description: nil, orderMode: .manual, homeRow: false,
            visibleFrom: nil, visibleTo: nil, coverStyle: "backdrop",
            coverTmdbId: nil, coverType: nil, clearCoverUrl: true
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let json = try String(decoding: encoder.encode(body), as: UTF8.self)
        #expect(json.contains("\"visible_from\":null"))
        #expect(json.contains("\"description\":null"))
        #expect(json.contains("\"cover_tmdb_id\":null"))
        #expect(json.contains("\"cover_url\":null"))
    }

    @Test func coverURLIsLeftAloneUnlessCleared() throws {
        let body = UpdateShelfBody(
            name: "Bond", description: nil, orderMode: .manual, homeRow: false,
            visibleFrom: nil, visibleTo: nil, coverStyle: "mosaic", coverTmdbId: nil, coverType: nil
        )
        let json = try String(decoding: JSONEncoder().encode(body), as: UTF8.self)
        #expect(!json.contains("coverUrl"))
    }
}
