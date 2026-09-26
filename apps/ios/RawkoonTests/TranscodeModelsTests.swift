import Foundation
@testable import Rawkoon
import Testing

struct TranscodeModelsTests {
    private func snakeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    private func plainSorted(_ value: some Encodable) throws -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return try String(decoding: e.encode(value), as: UTF8.self)
    }

    @Test func estimateRequestKeepsCamelSettingsAndSnakeSelection() throws {
        var s = TranscodeJobSettings()
        s.convertLosslessAudio = true
        s.resolution = .p1080
        let body = TranscodeEstimateRequest(
            selection: TranscodeSelection(fileIds: nil, mediaId: 7, season: 2), settings: s, refine: false
        )
        let json = try plainSorted(body)
        #expect(json.contains(#""selection":{"media_id":7,"season":2}"#))
        #expect(json.contains(#""convertLosslessAudio":true"#))
        #expect(json.contains(#""resolution":1080"#))
        #expect(!json.contains("convert_lossless_audio"))
        #expect(!json.contains("file_ids"))
    }

    @Test func keepResolutionEncodesAsString() throws {
        #expect(try plainSorted(TranscodeJobSettings()).contains(#""resolution":"keep""#))
    }

    @Test func decodesNumericAndKeepResolution() throws {
        let json = #"""
        {"jobs":[
          {"id":1,"media_file_id":3,"media_id":2,"batch_id":"b","title":"A","position":1,"status":"queued","step":null,
           "settings":{"codec":"av1","encoder":"software","resolution":720,"mode":"quality","preset":"small","speed":"default","convertLosslessAudio":false},
           "source_bytes":"10","estimated_bytes":"4","output_bytes":null,"source_nlink":null,"progress":null,"ssim_avg":null,"ssim_min":null,
           "error":null,"created_at":"x","started_at":null,"finished_at":null,"poster_url":null,"live":null},
          {"id":2,"media_file_id":null,"media_id":null,"batch_id":"b","title":"B","position":2,"status":"running","step":"encode",
           "settings":{"codec":"hevc","encoder":"vaapi","resolution":"keep","mode":"target","preset":"balanced","speed":"default","targetVideoKbps":3000,"convertLosslessAudio":true},
           "source_bytes":"10","estimated_bytes":null,"output_bytes":null,"source_nlink":2,"progress":0.5,"ssim_avg":null,"ssim_min":null,
           "error":null,"created_at":"x","started_at":"y","finished_at":null,"poster_url":"/p.jpg",
           "live":{"progress":0.5,"fps":210.5,"speed":8.8,"eta_secs":60,"current_bytes":"5"}}
        ]}
        """#
        let r = try snakeDecoder().decode(TranscodeJobsResponse.self, from: Data(json.utf8))
        #expect(r.jobs[0].settings.resolution == .p720)
        #expect(r.jobs[1].settings.resolution == .keep)
        #expect(r.jobs[1].settings.targetVideoKbps == 3000)
        #expect(r.jobs[1].live?.etaSecs == 60)
    }

    @Test func decodesSummaryWith30dKeys() throws {
        let json = #"""
        {"show":true,"state":"waiting_window","window_start":"01:00","current":null,"next":[],"queued_count":3,
         "queued_source_bytes":"30","queued_eta_secs":100,"saved_bytes_30d":"187","done_count_30d":34,
         "frees_after_seeding_bytes":"9","failed_count":1}
        """#
        let s = try snakeDecoder().decode(TranscodeSummary.self, from: Data(json.utf8))
        #expect(s.state == "waiting_window")
        #expect(s.savedBytes30D == "187")
        #expect(s.doneCount30D == 34)
    }

    @Test func decodesEstimateWithOptionalWidth() throws {
        let json = #"""
        {"files":[{"file_id":1,"title":"A","source_bytes":"10","estimated_bytes":"4","nlink":2,"duration_secs":100.5}],
         "excluded":[{"file_id":2,"title":"B","reason":"Already queued"}],
         "total_source_bytes":"10","total_estimated_bytes":"4","total_duration_secs":100,"total_audio_bytes":"1",
         "range_pct":15,"frees_now_bytes":"0","frees_after_seeding_bytes":"6","temporary_growth_bytes":"4","eta_secs":60,
         "source":"rough","refined_files":0,"refined_clips":0,"audio_changes":[{"label":"ENG · TRUEHD 8ch","to":"EAC3 768k"}],
         "source_height":1080}
        """#
        let e = try snakeDecoder().decode(TranscodeEstimate.self, from: Data(json.utf8))
        #expect(e.sourceWidth == nil)
        #expect(e.files.first?.nlink == 2)
        #expect(e.audioChanges.first?.to == "EAC3 768k")
    }

    @Test func settingsPatchSendsNullToClearThreads() throws {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.outputFormatting = [.sortedKeys]
        let cleared = try String(decoding: e.encode(TranscodeSettingsPatch(cpuThreads: .some(nil))), as: UTF8.self)
        #expect(cleared == #"{"cpu_threads":null}"#)
        let paused = try String(decoding: e.encode(TranscodeSettingsPatch(paused: true)), as: UTF8.self)
        #expect(paused == #"{"paused":true}"#)
    }
}
