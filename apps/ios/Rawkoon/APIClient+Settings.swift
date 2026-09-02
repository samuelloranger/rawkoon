import Foundation

/// Settings & device API methods. Kept out of APIClient.swift to stay under the
/// file_length lint threshold (spec §4.2). More settings methods land in later phases.
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

    // MARK: Media library settings + scan + reindex (spec §5 Phase 3)

    func postProcessingSettings() async throws -> PostProcessingSettingsResponseDTO {
        try await get("/api/library/post-processing/settings")
    }

    func updateMediaSettings(_ body: UpdateMediaSettingsBody) async throws {
        try await patchExpectOK("/api/library/post-processing/settings", body: body)
    }

    func scanLibrary(path: String, type: String?) async throws -> ScanResultDTO {
        try await post("/api/library/scan", body: ScanBody(path: path, type: type))
    }

    func startReindexLanguages() async throws -> ReindexStartResponse {
        try await post("/api/library/reindex-languages", body: EmptyBody())
    }

    func reindexLanguagesStatus() async throws -> ReindexStatusDTO {
        try await get("/api/library/reindex-languages/status")
    }

    // MARK: Books settings (non-CRUD — spec §5 Phase 3)

    func bookQualityProfiles() async throws -> BookQualityProfilesResponse {
        try await get("/api/book-quality-profiles")
    }

    func createBookQualityProfile(_ body: SaveBookQualityProfileBody) async throws {
        try await postExpectOK("/api/book-quality-profiles", body: body)
    }

    func updateBookQualityProfile(id: Int, _ body: SaveBookQualityProfileBody) async throws {
        try await patchExpectOK("/api/book-quality-profiles/\(id)", body: body)
    }

    func deleteBookQualityProfile(id: Int) async throws {
        try await deleteExpectOK("/api/book-quality-profiles/\(id)")
    }

    func updateBooksEnabled(_ enabled: Bool) async throws {
        try await patchExpectOK("/api/settings", body: BooksEnabledBody(booksEnabled: enabled))
    }

    func bookMetadataSources() async throws -> MetadataSourcesResponse {
        try await get("/api/books/metadata-sources")
    }

    func updateBookMetadataSources(order: [String]) async throws {
        try await putExpectOK("/api/books/metadata-sources", body: MetadataSourcesBody(order: order))
    }

    func updateBookFiles(_ body: UpdateBookFilesBody) async throws {
        try await patchExpectOK("/api/library/post-processing/settings", body: body)
    }

    // MARK: Arr import (spec §5 Phase 3)

    func startLibraryMigrate(_ body: MigrateBody) async throws -> MigrateStartResponse {
        try await post("/api/library/migrate", body: body)
    }

    // MARK: Quality profiles + custom formats CRUD (spec §5 Phase 4)

    func createQualityProfile(_ body: SaveQualityProfileBody) async throws {
        try await postExpectOK("/api/quality-profiles", body: body)
    }

    func updateQualityProfile(id: Int, _ body: SaveQualityProfileBody) async throws {
        try await putExpectOK("/api/quality-profiles/\(id)", body: body)
    }

    func deleteQualityProfile(id: Int) async throws {
        try await deleteExpectOK("/api/quality-profiles/\(id)")
    }

    func customFormats() async throws -> CustomFormatsResponse {
        try await get("/api/custom-formats")
    }

    func createCustomFormat(_ body: SaveCustomFormatBody) async throws {
        try await postExpectOK("/api/custom-formats", body: body)
    }

    func updateCustomFormat(id: Int, _ body: SaveCustomFormatBody) async throws {
        try await putExpectOK("/api/custom-formats/\(id)", body: body)
    }

    func deleteCustomFormat(id: Int) async throws {
        try await deleteExpectOK("/api/custom-formats/\(id)")
    }

    // MARK: Notification channels (per-user CRUD — spec §5 Phase 4)

    func notificationChannels() async throws -> NotificationChannelsResponse {
        try await get("/api/notifications/channels")
    }

    func createNotificationChannel(_ body: CreateChannelBody) async throws {
        try await postExpectOK("/api/notifications/channels", body: body)
    }

    func updateNotificationChannel(id: Int, _ body: UpdateChannelBody) async throws {
        try await patchExpectOK("/api/notifications/channels/\(id)", body: body)
    }

    func deleteNotificationChannel(id: Int) async throws {
        try await deleteExpectOK("/api/notifications/channels/\(id)")
    }

    func testNotificationChannel(id: Int) async throws {
        try await postExpectOK("/api/notifications/channels/\(id)/test", body: EmptyBody())
    }

    // MARK: Users admin + invitations (spec §5 Phase 5)

    func setUserRole(id: String, isAdmin: Bool) async throws {
        try await patchExpectOK("/api/admin/users/\(id)/role", body: SetRoleBody(isAdmin: isAdmin))
    }

    func resetUserPassword(id: String, newPassword: String) async throws {
        try await postExpectOK("/api/admin/users/\(id)/reset-password", body: ResetPasswordBody(newPassword: newPassword))
    }

    func deleteUser(id: String) async throws {
        try await deleteExpectOK("/api/admin/users/\(id)")
    }

    func createUser(_ body: CreateUserBody) async throws {
        try await postExpectOK("/api/admin/users", body: body)
    }

    func invitations() async throws -> InvitationsResponse {
        try await get("/api/admin/invitations")
    }

    func createInvitation(_ body: CreateInvitationBody) async throws -> TokenResponse {
        try await post("/api/admin/invitations", body: body)
    }

    func resendInvitation(id: Int) async throws -> TokenResponse {
        try await post("/api/admin/invitations/\(id)/resend", body: EmptyBody())
    }

    func revokeInvitation(id: Int) async throws {
        try await deleteExpectOK("/api/admin/invitations/\(id)")
    }

    // MARK: Sessions + web-push + API keys + blocklist (spec §5 Phase 5)

    func adminSessions() async throws -> AdminSessionsResponse {
        try await get("/api/admin/sessions")
    }

    func revokeSession(id: String) async throws {
        try await deleteExpectOK("/api/admin/sessions/\(id)")
    }

    func revokeUserSessions(userId: String) async throws {
        try await deleteExpectOK("/api/admin/sessions/user/\(userId)")
    }

    func adminWebPush() async throws -> AdminWebPushResponse {
        try await get("/api/admin/web-push")
    }

    func deleteWebPushSubscription(id: Int) async throws {
        try await deleteExpectOK("/api/admin/web-push/\(id)")
    }

    func apiKeys() async throws -> ApiKeysResponse {
        try await get("/api/admin/api-keys")
    }

    func createApiKey(_ body: CreateApiKeyBody) async throws -> CreateApiKeyResponse {
        try await post("/api/admin/api-keys", body: body)
    }

    func deleteApiKey(id: String) async throws {
        try await deleteExpectOK("/api/admin/api-keys/\(id)")
    }

    func blocklist() async throws -> BlocklistResponse {
        try await get("/api/medias/blocklist")
    }

    func unblock(id: Int) async throws {
        try await deleteExpectOK("/api/medias/blocklist/\(id)")
    }

    // MARK: SSO / OIDC providers CRUD (spec §5 Phase 5)

    func oidcProviders() async throws -> OidcProvidersResponse {
        try await get("/api/integrations/oidc")
    }

    func createOidcProvider(_ body: CreateOidcBody) async throws {
        try await postExpectOK("/api/integrations/oidc", body: body)
    }

    func updateOidcProvider(id: String, _ body: UpdateOidcBody) async throws {
        try await putExpectOK("/api/integrations/oidc/\(id)", body: body)
    }

    func deleteOidcProvider(id: String) async throws {
        try await deleteExpectOK("/api/integrations/oidc/\(id)")
    }

    // MARK: Releases + jobs (spec §5 Phase 5 + Appendix B)

    func releases() async throws -> ReleasesResponse {
        try await get("/api/releases")
    }

    func refreshReleases() async throws {
        try await postExpectOK("/api/releases/refresh", body: EmptyBody())
    }

    func triggerJobAction(_ action: String) async throws {
        try await postExpectOK("/api/admin/trigger-action", body: TriggerActionBody(action: action))
    }

    // MARK: Profile (spec §5 Phase 5)

    func updateProfile(_ body: UpdateProfileBody) async throws {
        try await putExpectOK("/api/users/me", body: body)
    }

    func changePassword(_ body: ChangePasswordBody) async throws {
        try await postExpectOK("/api/users/me/password", body: body)
    }
}
