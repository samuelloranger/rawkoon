import Foundation

/// Settings screens that paint from the cache before refetching. Members are
/// marked `nonisolated`: extensions take the module's MainActor default, and the
/// `APIClient` actor reads these synchronously.
nonisolated extension Endpoints {
    nonisolated static let apnsDevices = Endpoint<ApnsDevicesResponse>(path: "/api/notifications/apns/devices")
    nonisolated static let webPushDevices = Endpoint<WebPushDevicesResponse>(path: "/api/notifications/devices")
    nonisolated static let notificationChannels = Endpoint<NotificationChannelsResponse>(
        path: "/api/notifications/channels"
    )
    nonisolated static let qualityProfiles = Endpoint<QualityProfilesResponse>(path: "/api/quality-profiles")
    nonisolated static let indexers = Endpoint<IndexersResponse>(path: "/api/medias/indexers")
    nonisolated static let downloadClient = Endpoint<DownloadClientResponse>(path: "/api/integrations/download-client")
    nonisolated static let adminUsers = Endpoint<AdminUsersResponse>(path: "/api/admin/users")
}
