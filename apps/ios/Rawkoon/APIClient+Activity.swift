import Foundation
import RawkoonKit

// Activity feed, dashboard widgets, request approval, and the live library SSE streams.

extension APIClient {
    /// Migration job status stream. Kept as its own named method (rather than
    /// a bare `sseStream` call at the use site) so `ArrLibraryImportView` reads
    /// the same as before this was generalized.
    func libraryMigrateStatusStream() -> AsyncThrowingStream<MigrateStatusDTO, Error> {
        sseStream("/api/library/migrate/status")
    }

    /// Live library/book change feed. The handshake (`{connected:true,...}`)
    /// decodes but carries no id, so it is filtered out here rather than at
    /// each call site.
    func libraryEventsStream() -> AsyncThrowingStream<LibraryEvent, Error> {
        let raw: AsyncThrowingStream<LibraryEventDTO, Error> = sseStream("/api/library/events")
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in raw {
                        if let mapped = LibraryEvent.from(event) {
                            continuation.yield(mapped)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Downloads / activity / calendar
    func downloads(libraryId: Int) async throws -> DownloadsResponse {
        try await get("/api/library/\(libraryId)/downloads")
    }

    func speed() async throws -> SpeedResponse {
        try await get("/api/dashboard/downloads/speed")
    }

    func activityFeed(limit: Int = 50, service: String? = nil, type: String? = nil) async throws -> ActivityFeedResponse {
        try await get(Endpoints.activityFeed(limit: limit, service: service, type: type))
    }

    func upcoming() async throws -> UpcomingResponse {
        try await get(Endpoints.upcoming)
    }

    func dashboardPipeline() async throws -> DashboardPipeline {
        try await get(Endpoints.dashboardPipeline)
    }

    func dashboardHero() async throws -> DashboardHeroResponse {
        try await get(Endpoints.dashboardHero())
    }

    /// Home widgets
    func recentlyAdded(limit: Int = 24) async throws -> LibraryListResponse {
        try await get(Endpoints.recentlyAdded(limit: limit))
    }

    func nowPlaying() async throws -> NowPlayingResponse {
        try await get("/api/dashboard/jellyfin/now-playing")
    }

    func libraryAttention() async throws -> LibraryAttentionResponse {
        try await get(Endpoints.libraryAttention)
    }

    func libraryStats() async throws -> LibraryStats {
        let response: LibraryStatsResponse = try await get("/api/library/stats")
        return response.stats
    }

    nonisolated func cachedLibraryStats() -> LibraryStats? {
        let cached: Cached<LibraryStatsResponse>? = cached("/api/library/stats")
        return cached?.value.stats
    }

    func libraryGrowth() async throws -> LibraryGrowth {
        try await get(Endpoints.libraryGrowth).growth
    }

    func rssStatus() async throws -> RssStatusResponse {
        try await get(Endpoints.rssStatus)
    }

    /// The search fields are absent for a book request and on an older server.
    func approveRequest(
        id: Int, qualityProfileId: Int, seasons: SeasonChoice? = nil
    ) async throws -> ApproveRequestResult {
        try await post("/api/requests/\(id)/approve", body: ApproveRequestBody(
            qualityProfileId: qualityProfileId,
            seasonMode: seasons?.mode.rawValue,
            seasons: seasons?.seasonsPayload,
            monitorNewSeasons: seasons?.monitorNew
        ))
    }

    func denyRequest(id: Int, reason: String?) async throws {
        try await postExpectOK("/api/requests/\(id)/deny", body: DenyRequestBody(denyReason: reason))
    }

    func deleteRequest(id: Int) async throws {
        try await deleteExpectOK("/api/requests/\(id)")
    }
}

private nonisolated struct LibraryStatsResponse: Decodable {
    let stats: LibraryStats
}
