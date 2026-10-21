import Foundation
@testable import RawkoonKit
import Testing

struct AutoGrabTests {
    private func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    @Test func decodesSettingsSlice() throws {
        let json = #"{"settings":{"search_on_add":false,"release_check_cron":"0 */12 * * *","min_seed_ratio":1}}"#
        let value = try decoder().decode(AutoGrabSettingsResponse.self, from: Data(json.utf8))
        #expect(value.settings.searchOnAdd == false)
        #expect(value.settings.releaseCheckCron == "0 */12 * * *")
    }

    @Test func decodesRssPollInterval() throws {
        let json = #"{"settings":{"rss_poll_interval_minutes":5,"active_indexer_manager":"jackett"}}"#
        let value = try decoder().decode(AutoGrabSettingsResponse.self, from: Data(json.utf8))
        #expect(value.settings.rssPollIntervalMinutes == 5)
        #expect(value.settings.activeIndexerManager == "jackett")
    }

    @Test func rssPollIntervalFallsBackToTheDefault() {
        #expect(RssPollInterval.normalized(nil) == 15)
        #expect(RssPollInterval.normalized(7) == 15)
        #expect(RssPollInterval.normalized(30) == 30)
    }

    @Test func olderServerWithoutTheFieldsStillDecodes() throws {
        let value = try decoder().decode(AutoGrabSettingsResponse.self, from: Data(#"{"settings":{}}"#.utf8))
        #expect(value.settings.searchOnAdd == nil)
        #expect(value.settings.releaseCheckCron == nil)
        #expect(value.settings.rssPollIntervalMinutes == nil)
    }

    @Test func decodesReadinessChecks() throws {
        let json = """
        {"checks":[
          {"id":"indexer_manager","status":"ok","params":{"manager":"prowlarr","indexers":3}},
          {"id":"download_client","status":"error","params":{"reason":"unreachable","client_type":"qbittorrent"}},
          {"id":"default_movie_profile","status":"warn","params":{}},
          {"id":"profiles_without_maximum","status":"warn","params":{"profiles":[{"id":4,"name":"HD"}]}},
          {"id":"search_on_add","status":"ok","params":{"enabled":true}},
          {"id":"future_check","status":"warn","params":{"x":[1,2]}}
        ]}
        """
        let checks = try decoder().decode(GrabReadinessResponse.self, from: Data(json.utf8)).checks
        #expect(checks.count == 6)
        #expect(checks[0].params.indexers == 3)
        #expect(checks[1].params.clientType == "qbittorrent")
        #expect(checks[1].params.reason == "unreachable")
        #expect(checks[3].params.profiles == [.init(id: 4, name: "HD")])
        #expect(GrabReadiness.visible(checks).count == 5)
        #expect(GrabReadiness.problemCount(checks) == 3)
    }

    @Test func eachProblemPointsAtItsFix() {
        func fix(_ id: String, _ status: GrabReadinessStatus) -> GrabReadinessFix? {
            GrabReadinessCheck(id: id, status: status).fix
        }
        #expect(fix("indexer_manager", .error) == .indexerManager)
        #expect(fix("download_client", .error) == .downloadClient)
        #expect(fix("default_show_profile", .warn) == .defaultProfiles)
        #expect(fix("profiles_without_maximum", .warn) == .qualityProfiles)
        #expect(fix("download_client", .ok) == nil)
        #expect(fix("search_on_add", .ok) == nil)
    }

    @Test func decodesPendingReleases() throws {
        let json = """
        {"items":[
          {"target_key":"movie:1","media_id":1,"media_title":"A Movie","poster_url":null,"season":null,"episode":null,
           "release_title":"A.Movie.2024.1080p","candidate_count":2,"grab_after":"2026-10-17T08:00:00.000Z"},
          {"target_key":"episode:9","media_id":2,"media_title":"A Show","poster_url":"/p.jpg","season":1,"episode":2,
           "release_title":"A.Show.S01E02","candidate_count":1,"grab_after":"2026-10-17T08:00:00Z"}
        ]}
        """
        let items = try decoder().decode(PendingReleasesResponse.self, from: Data(json.utf8)).items
        #expect(items.count == 2)
        #expect(items[0].episodeCode == nil)
        #expect(items[1].episodeCode == "S01E02")
        #expect(items[0].grabAfterDate != nil)
        #expect(items[1].grabAfterDate == items[0].grabAfterDate)
        #expect(items[0].id == "movie:1")
    }

    @Test func grabNowReplies() throws {
        let ok = try decoder().decode(GrabPendingReleaseResponse.self, from: Data(#"{"grabbed":true,"reason":null}"#.utf8))
        #expect(ok == .init(grabbed: true, reason: nil))
        let blocked = try decoder().decode(GrabPendingReleaseResponse.self, from: Data(#"{"grabbed":false,"reason":"no_space"}"#.utf8))
        #expect(blocked.reason == .noSpace)
        let unknown = try decoder().decode(GrabPendingReleaseResponse.self, from: Data(#"{"grabbed":false,"reason":"brand_new"}"#.utf8))
        #expect(unknown.grabbed == false)
        #expect(unknown.reason == nil)
    }
}
