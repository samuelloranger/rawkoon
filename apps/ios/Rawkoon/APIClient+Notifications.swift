import Foundation
import RawkoonKit

// Notification center, APNs device registration, the live notification SSE
// stream, and per-user notification preferences. Split out of APIClient.swift
// to stay under the file_length lint threshold (spec §4.2).

extension APIClient {
    /// Live per-user notification feed. The handshake (`{connected:true}`)
    /// has no `id`, so it fails to decode as `StreamNotificationDTO` and is
    /// dropped by `sseStream` automatically — no separate filtering needed.
    func notificationStream() -> AsyncThrowingStream<StreamNotificationDTO, Error> {
        sseStream("/api/notifications/stream")
    }

    /// Notification center (spec §T3) — mirrors the web `/notifications` page.
    /// `read` filters server-side when set; omit it for "all".
    func notifications(
        page: Int? = nil, limit: Int? = nil, read: Bool? = nil
    ) async throws -> NotificationsResponseDTO {
        try await get("/api/notifications", query: [
            "page": page.map(String.init),
            "limit": limit.map(String.init),
            "read": read.map { $0 ? "true" : "false" },
        ])
    }

    func unreadNotificationCount() async throws -> UnreadCountResponseDTO {
        try await get("/api/notifications/unread-count")
    }

    func markNotificationRead(id: Int) async throws {
        try await putExpectOK("/api/notifications/\(id)/read", body: EmptyBody())
    }

    func markAllNotificationsRead() async throws {
        try await putExpectOK("/api/notifications/read-all", body: EmptyBody())
    }

    func deleteNotification(id: Int) async throws {
        try await deleteExpectOK("/api/notifications/\(id)")
    }

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

    func updateNotificationPrefs(_ prefs: [String: Bool]) async throws {
        try await putExpectOK("/api/users/me/notification-preferences", body: NotificationPrefsBody(notificationPreferences: prefs))
    }
}

private nonisolated struct ApnsUnregisterBody: Encodable {
    let deviceToken: String
}
