import Foundation
import RawkoonKit

extension APIClient {
    func transcodeCapabilities() async throws -> TranscodeCapabilities {
        try await get("/api/transcode/capabilities")
    }

    func transcodeEstimate(selection: TranscodeSelection, settings: TranscodeJobSettings, refine: Bool) async throws -> TranscodeEstimate {
        try await postPlainBody(
            "/api/transcode/estimate",
            body: TranscodeEstimateRequest(selection: selection, settings: settings, refine: refine),
            slow: true
        )
    }

    func enqueueTranscode(selection: TranscodeSelection, settings: TranscodeJobSettings) async throws -> TranscodeEnqueueResponse {
        try await postPlainBody("/api/transcode/jobs", body: TranscodeEnqueueRequest(selection: selection, settings: settings))
    }

    func transcodeJobs(active: Bool) async throws -> [TranscodeJob] {
        let since = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-30 * 86400))
        let query: [String: String?] = active
            ? ["status": "queued,running"]
            : ["status": "done,failed,cancelled", "since": since]
        let response: TranscodeJobsResponse = try await get("/api/transcode/jobs", query: query)
        return response.jobs
    }

    func cancelTranscodeJob(id: Int) async throws {
        try await deleteExpectOK("/api/transcode/jobs/\(id)")
    }

    /// `nil` placement moves the job to the top of the queue.
    func moveTranscodeJob(id: Int, placement: TranscodeMovePlacement?) async throws {
        nonisolated struct Body: Encodable { var top: Bool?; var beforeId: Int?; var afterId: Int? }
        let body = switch placement {
        case nil: Body(top: true)
        case let .before(other): Body(beforeId: other)
        case let .after(other): Body(afterId: other)
        }
        try await postExpectOK("/api/transcode/jobs/\(id)/move", body: body)
    }

    func retryTranscodeJob(id: Int) async throws {
        nonisolated struct Empty: Encodable {}
        try await postExpectOK("/api/transcode/jobs/\(id)/retry", body: Empty())
    }

    /// Removes the torrents still holding a finished job's old file, and that file.
    func freeTranscodeSource(id: Int) async throws -> TranscodeFreeSourceDTO {
        nonisolated struct Empty: Encodable {}
        return try await post("/api/transcode/jobs/\(id)/free-source", body: Empty())
    }

    /// Deletes a failed or cancelled job from the history with its partial output.
    func discardTranscodeJob(id: Int) async throws {
        try await deleteExpectOK("/api/transcode/history/\(id)")
    }

    func removeTranscodeBatch(id: String) async throws {
        try await deleteExpectOK("/api/transcode/batches/\(id)")
    }

    func moveTranscodeBatchToTop(id: String) async throws {
        nonisolated struct Body: Encodable { let top = true }
        try await postExpectOK("/api/transcode/batches/\(id)/move", body: Body())
    }

    func clearTranscodeHistory() async throws {
        try await deleteExpectOK("/api/transcode/history")
    }

    func transcodeSettings() async throws -> TranscodeQueueSettings {
        try await get("/api/transcode/settings")
    }

    func updateTranscodeSettings(_ changes: TranscodeSettingsPatch) async throws -> TranscodeQueueSettings {
        try await patch("/api/transcode/settings", body: changes)
    }

    func transcodeSummary() async throws -> TranscodeSummary {
        try await get("/api/transcode/summary")
    }

    func registerReencodePushToStart(installationId: String, token: String) async throws {
        try await postExpectOK("/api/transcode/live-activity/register", body: ReencodeStartRegistration(
            installationId: installationId, startToken: token
        ))
    }

    func registerReencodeActivityToken(installationId: String, jobId: Int, token: String) async throws {
        try await postExpectOK("/api/transcode/live-activity/token", body: ReencodeTokenRegistration(
            installationId: installationId, jobId: jobId, activityToken: token
        ))
    }

    func unregisterReencodePushToStart(installationId: String) async throws {
        try await deleteExpectOK("/api/transcode/live-activity/devices/\(installationId)")
    }
}

private nonisolated struct ReencodeStartRegistration: Encodable {
    let installationId: String
    let startToken: String
}

private nonisolated struct ReencodeTokenRegistration: Encodable {
    let installationId: String
    let jobId: Int
    let activityToken: String
}
