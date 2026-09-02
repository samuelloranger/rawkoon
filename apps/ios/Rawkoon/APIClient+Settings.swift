import Foundation

// Settings & device API methods. Kept out of APIClient.swift to stay under the
// file_length lint threshold (spec §4.2). More settings methods land in later phases.
extension APIClient {
    // MARK: Notification devices (roster — spec §5 Phase 1)

    /// This user's registered iOS (APNS) devices.
    func apnsDevices() async throws -> ApnsDevicesResponse {
        try await get("/api/notifications/apns/devices")
    }

    /// Remove one iOS device token (400 if not the caller's or already gone).
    func deleteApnsDevice(id: Int) async throws {
        try await deleteExpectOK("/api/notifications/apns/devices/\(id)")
    }

    /// This user's registered web-push devices (browsers).
    func webPushDevices() async throws -> WebPushDevicesResponse {
        try await get("/api/notifications/devices")
    }

    /// Remove one web-push device.
    func deleteWebPushDevice(id: Int) async throws {
        try await deleteExpectOK("/api/notifications/devices/\(id)")
    }

    // MARK: General app settings (spec §5 Phase 2)

    func generalSettings() async throws -> AppSettingsResponseDTO {
        try await get("/api/settings")
    }

    func updateGeneralSettings(_ body: UpdateGeneralSettingsBody) async throws {
        try await patchExpectOK("/api/settings", body: body)
    }

    // MARK: Simple integrations (spec §5 Phase 2)

    func tmdbIntegration() async throws -> TmdbIntegrationResponse {
        try await get("/api/integrations/tmdb")
    }
    func saveTmdbIntegration(_ body: SaveTmdbBody) async throws {
        try await putExpectOK("/api/integrations/tmdb", body: body)
    }

    func jellyfinIntegration() async throws -> JellyfinIntegrationResponse {
        try await get("/api/integrations/jellyfin")
    }
    func saveJellyfinIntegration(_ body: SaveJellyfinBody) async throws {
        try await putExpectOK("/api/integrations/jellyfin", body: body)
    }

    func localAiIntegration() async throws -> LocalAiIntegrationResponse {
        try await get("/api/integrations/local-ai")
    }
    func saveLocalAiIntegration(_ body: SaveLocalAiBody) async throws {
        try await putExpectOK("/api/integrations/local-ai", body: body)
    }
    func testLocalAi() async throws -> LocalAiTestResponse {
        try await get("/api/integrations/local-ai/test")
    }

    // MARK: Indexer managers — Prowlarr / Jackett (spec §5 Phase 2)

    func indexerManager(_ kind: String) async throws -> IndexerManagerResponse {
        try await get("/api/integrations/\(kind)")
    }
    func saveIndexerManager(_ kind: String, body: SaveIndexerManagerBody) async throws {
        try await putExpectOK("/api/integrations/\(kind)", body: body)
    }
    func indexerManagerIndexers(_ kind: String) async throws -> IndexerListResponse {
        try await get("/api/integrations/\(kind)/indexers")
    }

    // MARK: Download client + hook (spec §5 Phase 2)

    func downloadClientConfig() async throws -> DownloadClientEditResponse {
        try await get("/api/integrations/download-client")
    }
    func saveDownloadClient(_ body: SaveDownloadClientBody) async throws {
        try await putExpectOK("/api/integrations/download-client", body: body)
    }
    func testDownloadClient(_ body: SaveDownloadClientBody) async throws -> DownloadClientTestResponse {
        try await post("/api/integrations/download-client/test", body: body)
    }
    func downloadClientHook() async throws -> HookConfigDTO {
        try await getPlain("/api/integrations/download-client/hook")
    }
    func saveDownloadClientHook(_ body: SaveHookBody) async throws -> HookConfigDTO {
        try await putPlain("/api/integrations/download-client/hook", body: body)
    }
    func rotateDownloadClientHook() async throws {
        try await postPlainExpectOK("/api/integrations/download-client/hook/rotate", body: EmptyBody())
    }

    // MARK: Books providers — Audnexus / Google Books (spec §5 Phase 2)

    func audnexusIntegration() async throws -> AudnexusIntegrationResponse {
        try await get("/api/integrations/audnexus")
    }
    func updateAudnexusIntegration(_ body: SaveAudnexusBody) async throws {
        try await putExpectOK("/api/integrations/audnexus", body: body)
    }
    func testAudnexus(_ body: AudnexusTestBody) async throws -> IntegrationTestResponse {
        try await post("/api/integrations/audnexus/test", body: body)
    }
    func googleBooksIntegration() async throws -> GoogleBooksIntegrationResponse {
        try await get("/api/integrations/googlebooks")
    }
    func updateGoogleBooksIntegration(_ body: SaveGoogleBooksBody) async throws {
        try await putExpectOK("/api/integrations/googlebooks", body: body)
    }
    func testGoogleBooks(_ body: GoogleBooksTestBody) async throws -> IntegrationTestResponse {
        try await post("/api/integrations/googlebooks/test", body: body)
    }
}
