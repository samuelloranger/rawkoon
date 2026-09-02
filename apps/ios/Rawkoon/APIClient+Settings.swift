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
}
