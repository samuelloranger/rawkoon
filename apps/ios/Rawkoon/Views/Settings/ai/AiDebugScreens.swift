#if DEBUG
    import SwiftUI

    /// Synthetic AI payloads for the screenshot harness, decoded through the same
    /// decoder the app uses so the fixtures also exercise the models.
    enum AiDebugFixtures {
        static func decode<T: Decodable>(_ json: String) -> T {
            // swiftlint:disable:next force_try
            try! APIClient.mediaDecoder.decode(T.self, from: Data(json.utf8))
        }

        private static func metrics(calls: Int, cost: Double) -> String {
            """
            "calls": \(calls), "ok": \(calls - 3), "invalid_pick": 1, "rate_limited": 1, "error": 1,
            "budget_skipped": 2, "agreement_checked": \(calls - 4), "agreement_rate": 0.82,
            "success_rate": 0.9, "input_tokens": \(calls * 1800), "output_tokens": \(calls * 210),
            "total_tokens": \(calls * 2010), "avg_duration_ms": 1400, "p50_duration_ms": 1200,
            "p95_duration_ms": 3900, "estimated_cost": \(cost)
            """
        }

        static var stats: AiStatsResponse {
            let days = (0 ..< 30).map { index -> String in
                let calls = [0, 3, 8, 12, 5, 0, 20, 9][index % 8]
                let day = String(format: "2026-09-%02d", index + 1)
                let cost = Double(calls) * 0.004
                return """
                {"date":"\(day)","calls":\(calls),"errors":\(calls > 10 ? 1 : 0),"rate_limited":0,"budget_skipped":0,
                 "total_tokens":\(calls * 2000),"estimated_cost":\(cost)}
                """
            }.joined(separator: ",")
            return decode("""
            {"days":30,
             "totals":{\(metrics(calls: 142, cost: 0.57))},
             "by_feature":[{"feature":"release_pick_rss",\(metrics(calls: 96, cost: 0.38))},
                           {"feature":"release_pick_interactive",\(metrics(calls: 46, cost: 0.19))}],
             "by_model":[{"model":"gpt-4o-mini",\(metrics(calls: 142, cost: 0.57))}],
             "by_trigger":[{"trigger":"rss",\(metrics(calls: 96, cost: 0.38))},
                           {"trigger":"interactive",\(metrics(calls: 40, cost: 0.17))},
                           {"trigger":null,\(metrics(calls: 6, cost: 0.02))}],
             "daily":[\(days)],
             "grabs":{"ai":{"total":88,"completed":80,"failed":3,"active":5},
                      "classic":{"total":31,"completed":26,"failed":4,"active":1}},
             "prices_configured":true,"today_spend":0.42,"daily_budget_usd":0.5}
            """)
        }

        static var integration: AiProviderIntegrationDTO {
            decode("""
            {"enabled":true,"base_url":"https://api.example.com/v1","model":"gpt-4o-mini","has_api_key":true,
             "input_price_per_million":0.15,"output_price_per_million":0.6,"daily_budget_usd":0.5,
             "features":{"release_pick_search":false}}
            """)
        }

        static var calls: AiCallsResponse {
            decode("""
            {"total":47,"page":1,"page_size":20,"calls":[
             {"id":3,"feature":"release_pick_interactive","model":"gpt-4o-mini","structured":true,"status":"ok",
              "trigger":"interactive","classic_title":"Example.Movie.2024.1080p.WEB-DL.x264","agreed_with_classic":false,
              "error":null,"input_tokens":2140,"output_tokens":160,"total_tokens":2300,"duration_ms":1630,
              "estimated_cost":0.0004,"media_id":12,"media_title":"Example Movie","media_type":"movie",
              "book_id":null,"book_edition_id":null,"book_title":null,
              "picked_title":"Example.Movie.2024.2160p.WEB-DL.DDP5.1.x265",
              "reasoning":"Higher resolution with a healthy seeder count, and the audio track matches the profile.",
              "created_at":"2026-09-30T14:02:00.000Z"},
             {"id":2,"feature":"release_pick_rss","model":"gpt-4o-mini","structured":true,"status":"rate_limited",
              "trigger":"rss","classic_title":null,"agreed_with_classic":null,
              "error":"Provider returned 429 Too Many Requests","input_tokens":null,"output_tokens":null,
              "total_tokens":null,"duration_ms":420,"estimated_cost":null,"media_id":9,"media_title":"Another Show S02E04",
              "media_type":"tv","book_id":null,"book_edition_id":null,"book_title":null,"picked_title":null,
              "reasoning":null,"created_at":"2026-09-30T13:40:00.000Z"},
             {"id":1,"feature":"book_release_pick","model":"gpt-4o-mini","structured":true,"status":"budget_skipped",
              "trigger":"rss","classic_title":null,"agreed_with_classic":null,"error":null,"input_tokens":null,
              "output_tokens":null,"total_tokens":null,"duration_ms":0,"estimated_cost":null,"media_id":null,
              "media_title":null,"media_type":null,"book_id":4,"book_edition_id":6,"book_title":"A Long Book Title",
              "picked_title":null,"reasoning":null,"created_at":"2026-09-30T12:10:00.000Z"}]}
            """)
        }

        static var release: ReleaseItem {
            decode("""
            {"guid":"g1","title":"Example.Movie.2024.2160p.WEB-DL.DDP5.1.x265","languages":["en"]}
            """)
        }
    }

    /// Which slice of the AI screen to show: the harness cannot scroll, so each
    /// screenshot jumps to a section id instead.
    struct DebugAiSettings: View {
        let scrollTo: String?

        @State private var config = AiProviderConfigModel()
        @State private var period: AiStatsPeriod = .month

        var body: some View {
            NavigationStack {
                ScrollViewReader { proxy in
                    Form {
                        AiProviderConfigSections(config: config, api: { nil })
                        Section {
                            SegmentedRow(
                                title: "Period", selection: $period,
                                options: AiStatsPeriod.allCases.map { (value: $0, label: $0.title) }
                            )
                            .id("ai-usage")
                        } header: {
                            Text("Usage")
                        }
                        AiStatsSections(stats: AiDebugFixtures.stats)
                        Section {
                            NavigationLink {
                                AiCallHistoryView(preview: AiDebugFixtures.calls)
                            } label: {
                                Label("Call history", systemImage: "clock.arrow.circlepath")
                            }
                        }
                        .listRowBackground(Theme.raised)
                    }
                    .scrollContentBackground(.hidden)
                    .background(Theme.base)
                    .tint(Theme.apricot)
                    .navigationTitle("AI")
                    .navigationBarTitleDisplayMode(.inline)
                    .onAppear {
                        config.apply(AiDebugFixtures.integration)
                        if let scrollTo {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                                proxy.scrollTo(scrollTo, anchor: .top)
                            }
                        }
                    }
                }
            }
        }
    }

    struct DebugAiHistory: View {
        let detail: Bool

        var body: some View {
            NavigationStack {
                if detail {
                    AiCallDetailView(call: AiDebugFixtures.calls.calls[0])
                } else {
                    AiCallHistoryView(preview: AiDebugFixtures.calls)
                }
            }
        }
    }

    struct DebugAiBanner: View {
        let budgetReached: Bool
        @Environment(AppModel.self) private var model

        var body: some View {
            VStack(spacing: 12) {
                Text("Release search").font(.headline).foregroundStyle(Theme.textStrong)
                AiPickBanner(
                    aiPickLoading: false, aiPickError: nil, aiPickBudgetReached: budgetReached,
                    aiPickedRelease: AiDebugFixtures.release, aiPickGrabbed: false,
                    aiPick: AiPick(
                        releaseKey: "g1",
                        reasoning: "Higher resolution with a healthy seeder count, and the audio matches the profile."
                    ),
                    grabbingGuid: nil, onRetry: {}, onGrab: { _ in }, onDismiss: {}
                )
                Spacer()
            }
            .padding(.top, 80)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.base)
        }
    }
#endif
