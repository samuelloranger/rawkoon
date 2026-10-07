import Foundation
@testable import Rawkoon
import Testing

/// Fixtures are shaped exactly like `AiStatsResponse` / `AiCallsResponse` /
/// `AiProviderIntegration` in `apps/shared/src/types`.
struct AiModelsTests {
    private let metrics = """
    "calls": 10, "ok": 7, "invalid_pick": 1, "rate_limited": 1, "error": 1, "budget_skipped": 2,
    "agreement_checked": 6, "agreement_rate": 0.5, "success_rate": 0.7, "input_tokens": 1000,
    "output_tokens": 200, "total_tokens": 1200, "avg_duration_ms": 1100.5, "p50_duration_ms": 900,
    "p95_duration_ms": 2500, "estimated_cost": 0.0123
    """

    private func decode<T: Decodable>(_ json: String) throws -> T {
        try APIClient.mediaDecoder.decode(T.self, from: Data(json.utf8))
    }

    private func encoded(_ body: some Encodable) throws -> [String: Any] {
        let data = try APIClient.mediaEncoder.encode(body)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func decodesStatsResponse() throws {
        let stats: AiStatsResponse = try decode("""
        {"days": 30, "totals": {\(metrics)},
         "by_feature": [{"feature": "release_pick_rss", \(metrics)}],
         "by_model": [{"model": "m1", \(metrics)}],
         "by_trigger": [{"trigger": null, \(metrics)}, {"trigger": "rss", \(metrics)}],
         "daily": [{"date": "2026-09-01", "calls": 3, "errors": 1, "rate_limited": 0, "budget_skipped": 2,
                    "total_tokens": 900, "estimated_cost": null}],
         "grabs": {"ai": {"total": 5, "completed": 3, "failed": 1, "active": 1},
                   "classic": {"total": 0, "completed": 0, "failed": 0, "active": 0}},
         "prices_configured": false, "today_spend": null, "daily_budget_usd": 2.5}
        """)
        #expect(stats.days == 30)
        #expect(stats.totals.invalidPick == 1)
        #expect(stats.totals.budgetSkipped == 2)
        #expect(stats.totals.agreementRate == 0.5)
        #expect(stats.totals.p50DurationMs == 900)
        #expect(stats.totals.estimatedCost == 0.0123)
        #expect(stats.byFeature.first?.feature == "release_pick_rss")
        #expect(stats.byFeature.first?.metrics.calls == 10)
        #expect(stats.byModel.first?.model == "m1")
        #expect(stats.byTrigger.map(\.trigger) == [nil, "rss"])
        #expect(stats.daily.first?.estimatedCost == nil)
        #expect(stats.daily.first?.budgetSkipped == 2)
        #expect(stats.grabs.ai.active == 1)
        #expect(!stats.pricesConfigured)
        #expect(stats.todaySpend == nil)
        #expect(stats.dailyBudgetUsd == 2.5)
    }

    @Test func nullableMetricsDecodeAsNil() throws {
        let row: AiUsageMetrics = try decode("""
        {"calls": 0, "ok": 0, "invalid_pick": 0, "rate_limited": 0, "error": 0, "budget_skipped": 0,
         "agreement_checked": 0, "agreement_rate": null, "success_rate": 0, "input_tokens": 0,
         "output_tokens": 0, "total_tokens": 0, "avg_duration_ms": null, "p50_duration_ms": null,
         "p95_duration_ms": null, "estimated_cost": null}
        """)
        #expect(row.agreementRate == nil)
        #expect(row.p95DurationMs == nil)
        #expect(row.estimatedCost == nil)
    }

    @Test func decodesCallsResponse() throws {
        let response: AiCallsResponse = try decode("""
        {"total": 41, "page": 2, "page_size": 20, "calls": [
          {"id": 9, "feature": "release_pick_interactive", "model": "m1", "structured": true, "status": "ok",
           "trigger": "interactive", "classic_title": "Classic.Title", "agreed_with_classic": false,
           "error": null, "input_tokens": 100, "output_tokens": 20, "total_tokens": 120, "duration_ms": 850,
           "estimated_cost": 0.001, "media_id": 3, "media_title": "A Movie", "media_type": "movie",
           "book_id": null, "book_edition_id": null, "book_title": null, "picked_title": "AI.Title",
           "reasoning": "Better audio", "created_at": "2026-09-30T14:02:00.000Z"},
          {"id": 8, "feature": "book_release_pick", "model": "m1", "structured": false, "status": "budget_skipped",
           "trigger": null, "classic_title": null, "agreed_with_classic": null, "error": null,
           "input_tokens": null, "output_tokens": null, "total_tokens": null, "duration_ms": 0,
           "estimated_cost": null, "media_id": null, "media_title": null, "media_type": null,
           "book_id": 4, "book_edition_id": 6, "book_title": "A Book", "picked_title": null,
           "reasoning": null, "created_at": "2026-09-30T13:00:00Z"}]}
        """)
        #expect(response.total == 41)
        #expect(response.pageSize == 20)
        let first = try #require(response.calls.first)
        #expect(first.targetTitle == "A Movie")
        #expect(first.agreedWithClassic == false)
        #expect(first.date != nil)
        #expect(first.durationMs == 850)
        let second = try #require(response.calls.last)
        #expect(second.targetTitle == "A Book")
        #expect(second.inputTokens == nil)
        #expect(AiCallStatus(rawValue: second.status) == .budgetSkipped)
        #expect(second.date != nil)
    }

    @Test func decodesExtendedIntegration() throws {
        let response: AiProviderIntegrationResponse = try decode("""
        {"integration": {"type": "ai-provider", "enabled": true, "base_url": "http://x", "model": "m",
         "has_api_key": true, "input_price_per_million": 0.15, "output_price_per_million": null,
         "daily_budget_usd": 1.5, "features": {"release_pick_interactive": false}}}
        """)
        let integration = response.integration
        #expect(integration.inputPricePerMillion == 0.15)
        #expect(integration.outputPricePerMillion == nil)
        #expect(integration.dailyBudgetUsd == 1.5)
        #expect(integration.features?.isOn(.releasePickInteractive) == false)
        #expect(integration.features?.isOn(.releasePickRss) == true)
    }

    @Test func missingFeatureKeysMeanOn() throws {
        let response: AiProviderIntegrationResponse = try decode(
            #"{"integration": {"enabled": true, "base_url": "", "model": "", "has_api_key": false, "features": {}}}"#
        )
        for feature in AiFeature.allCases {
            #expect(response.integration.features?.isOn(feature) == true)
        }
    }

    @Test func saveBodySendsNullForClearedFields() throws {
        let body = SaveAiProviderBody(
            enabled: true, baseUrl: "http://x", model: "m", apiKey: "",
            inputPricePerMillion: nil, outputPricePerMillion: 0.6, dailyBudgetUsd: nil,
            features: AiFeatureToggles()
        )
        let json = try encoded(body)
        #expect(json["input_price_per_million"] is NSNull)
        #expect(json["daily_budget_usd"] is NSNull)
        #expect(json["output_price_per_million"] as? Double == 0.6)
        #expect(json["base_url"] as? String == "http://x")
        #expect(json["api_key"] as? String == "")
    }

    @Test func saveBodySpellsOutEveryFeature() throws {
        var features = AiFeatureToggles()
        features.set(.releasePickSearch, on: false)
        let body = SaveAiProviderBody(
            enabled: false, baseUrl: "", model: "", apiKey: "",
            inputPricePerMillion: nil, outputPricePerMillion: nil, dailyBudgetUsd: nil, features: features
        )
        let sent = try #require(try encoded(body)["features"] as? [String: Bool])
        #expect(sent == [
            "release_pick_rss": true,
            "release_pick_interactive": true,
            "release_pick_search": false,
            "book_release_pick": true,
        ])
    }

    @Test func aiPickRequestCarriesMediaId() throws {
        let context = AiPickMediaContext(title: "T", year: nil, type: "movie")
        let withId = try encoded(AiPickRequest(mediaContext: context, releases: [], mediaId: 7))
        #expect(withId["media_id"] as? Int == 7)
        let without = try encoded(AiPickRequest(mediaContext: context, releases: [], mediaId: nil))
        #expect(without["media_id"] == nil)
    }

    @Test func aiPickContextEncodesSeasonAndEpisodeWhenKnown() throws {
        let episode = AiPickMediaContext(title: "T", year: 2020, type: "tv", season: 2, episode: 5)
        let sent = try #require(try encoded(AiPickRequest(mediaContext: episode, releases: [], mediaId: 7))["media_context"] as? [String: Any])
        #expect(sent["season"] as? Int == 2)
        #expect(sent["episode"] as? Int == 5)
        let movie = AiPickMediaContext(title: "T", year: nil, type: "movie")
        let bare = try #require(try encoded(AiPickRequest(mediaContext: movie, releases: [], mediaId: nil))["media_context"] as? [String: Any])
        #expect(bare["season"] == nil)
        #expect(bare["episode"] == nil)
    }
}
