import Foundation
@testable import Rawkoon
import Testing

/// The rules as the server reads and writes them: empty means null, and unset fields never go out.
struct ShelfRulesTests {
    private func encode(_ body: some Encodable) throws -> [String: Any] {
        let data = try APIClient.mediaEncoder.encode(body)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.mediaDecoder.decode(type, from: Data(json.utf8))
    }

    @Test func anEmptyDraftIsNoRules() {
        var draft = ShelfRulesDraft()
        #expect(draft.rules == nil)
        draft.yearMin = "  "
        draft.certifications = [" "]
        draft.collection = "0"
        #expect(draft.rules == nil)
    }

    @Test func clearingSendsAnExplicitNull() throws {
        let json = try encode(SaveShelfRulesBody(rules: nil))
        #expect(json.count == 1)
        #expect(json["rules"] is NSNull)
    }

    @Test func unsetFieldsAreOmittedAndKeysAreSnakeCase() throws {
        var draft = ShelfRulesDraft()
        draft.types = ["show", "movie"]
        draft.genresNone = [27]
        draft.collection = "645"
        draft.ratingMin = "7,5"
        let rules = try #require(draft.rules)
        let json = try #require(try encode(SaveShelfRulesBody(rules: rules))["rules"] as? [String: Any])
        #expect(Set(json.keys) == ["types", "genres_none", "tmdb_collection", "rating_min"])
        #expect(json["types"] as? [String] == ["movie", "show"])
        #expect(json["rating_min"] as? Double == 7.5)
    }

    @Test func aDraftRoundTripsSavedRules() throws {
        let saved = try decode(ShelfRules.self, #"{"genres_any": [10751], "year_min": 1990, "certifications": ["G"]}"#)
        #expect(ShelfRulesDraft(saved).rules == saved)
        #expect(ShelfRulesDraft(saved).yearMin == "1990")
    }

    @Test func aShelfCarriesItsRulesNamesAndRuleEntries() throws {
        let shelf = try decode(ShelfDetail.self, """
        {"id": 1, "name": "A", "description": null, "cover": {"style": "mosaic", "posters": []},
         "entry_count": 2, "in_library_count": 0, "home_row": false, "visible_now": true,
         "order_mode": "manual", "visible_from": null, "visible_to": null,
         "cover_tmdb_id": null, "cover_type": null, "seed_key": null,
         "rules": {"keywords_any": [5]}, "auto_join": true, "rule_names": {"keyword:5": "holiday"},
         "entries": [
          {"id": 1, "tmdb_id": 9, "type": "movie", "season": null, "title": "X", "year": 2000,
           "poster_url": null, "group_label": null, "position": 0, "in_library": true, "library_id": 3,
           "source": "rule", "reason": ["keyword: holiday"], "excluded": false},
          {"id": 2, "tmdb_id": 10, "type": "movie", "season": null, "title": "Y", "year": null,
           "poster_url": null, "group_label": null, "position": 1, "in_library": false, "library_id": null,
           "source": "rule", "reason": [], "excluded": true}]}
        """)
        #expect(shelf.rules?.keywordsAny == [5])
        #expect(shelf.autoJoin == true)
        #expect(shelf.ruleNames?["keyword:5"] == "holiday")
        #expect(shelf.entries[0].isRuleEntry)
        #expect(shelf.entries[0].reason == ["keyword: holiday"])
        #expect(shelf.entries.map(\.excluded) == [false, true])
    }

    @Test func anOlderServerOmitsTheRuleFields() throws {
        let entry = try decode(ShelfEntry.self, """
        {"id": 1, "tmdb_id": 9, "type": "movie", "season": null, "title": "X", "year": null,
         "poster_url": null, "group_label": null, "position": 0, "in_library": false, "library_id": null}
        """)
        #expect(!entry.isRuleEntry)
        #expect(entry.excluded == nil)
    }

    @Test func aPreviewDecodesBothLists() throws {
        let preview = try decode(ShelfPreview.self, """
        {"matches": [{"tmdb_id": 1, "type": "movie", "title": "A", "year": 1999, "poster_url": null,
                      "in_shelf": true, "reason": ["genre"]}],
         "excluded": [{"tmdb_id": 2, "type": "show", "title": "B", "year": null, "poster_url": "p.jpg",
                       "in_shelf": false, "reason": ["not horror"]}],
         "truncated": true}
        """)
        #expect(preview.matches[0].inShelf)
        #expect(preview.excluded[0].id == "show-2")
        #expect(preview.truncated)
    }
}
