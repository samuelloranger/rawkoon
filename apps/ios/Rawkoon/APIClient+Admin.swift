import Foundation
import RawkoonKit

extension APIClient {
    /// APNs device registration
    func registerApns(deviceToken: String, deviceName: String?, osVersion: String?, appVersion: String?, bundleId: String?) async throws {
        try await postExpectOK("/api/notifications/apns/register", body: ApnsRegisterBody(
            deviceToken: deviceToken,
            deviceInfo: ApnsDeviceInfo(deviceName: deviceName, osVersion: osVersion, appVersion: appVersion, bundleId: bundleId)
        ))
    }

    /// Drops this device's token on sign-out, so the next account on the phone
    /// does not receive the previous one's notifications.
    func unregisterApns(deviceToken: String) async throws {
        try await postExpectOK(
            "/api/notifications/apns/unregister",
            body: ApnsUnregisterBody(deviceToken: deviceToken)
        )
    }

    func qualityProfiles() async throws -> QualityProfilesResponse {
        try await get("/api/quality-profiles")
    }

    func indexers() async throws -> IndexersResponse {
        try await get("/api/medias/indexers")
    }

    func downloadClient() async throws -> DownloadClientResponse {
        try await get("/api/integrations/download-client")
    }

    func adminUsers() async throws -> AdminUsersResponse {
        try await get("/api/admin/users")
    }

    func systemVersion() async throws -> SystemVersion {
        try await get("/api/system/version")
    }

    func approveRequest(id: Int, qualityProfileId: Int) async throws {
        try await postExpectOK("/api/requests/\(id)/approve", body: ApproveRequestBody(qualityProfileId: qualityProfileId))
    }

    func denyRequest(id: Int, reason: String?) async throws {
        try await postExpectOK("/api/requests/\(id)/deny", body: DenyRequestBody(denyReason: reason))
    }

    func updateNotificationPrefs(_ prefs: [String: Bool]) async throws {
        try await putExpectOK("/api/users/me/notification-preferences", body: NotificationPrefsBody(notificationPreferences: prefs))
    }
}

nonisolated private struct ApnsUnregisterBody: Encodable {
    let deviceToken: String
}
