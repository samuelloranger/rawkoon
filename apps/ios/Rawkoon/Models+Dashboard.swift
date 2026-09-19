import Foundation

// Home/dashboard widgets, APNs, SSO, notification center, and live library-event DTOs. Split out of Models.swift to stay under the file_length lint
// threshold (spec §4.2). Pure data types, no behaviour.

// MARK: - Home / dashboard widgets

nonisolated struct NowPlayingResponse: Decodable, Sendable {
    let enabled: Bool
    let sessions: [NowPlayingSession]?
}

nonisolated struct NowPlayingSession: Decodable, Identifiable, Sendable {
    let sessionId: String
    let user: String?
    let device: String?
    let title: String?
    let posterUrl: String?
    let progressPct: Double?
    let paused: Bool?
    var id: String {
        sessionId
    }
}

nonisolated struct LibraryAttentionResponse: Decodable, Sendable {
    let items: [AttentionItem]
}

nonisolated struct AttentionItem: Decodable, Identifiable, Sendable {
    let id: Int
    let kind: String?
    let mediaId: Int?
    let mediaTitle: String?
    let mediaType: String?
    let detail: String?
}

nonisolated struct RssStatusResponse: Decodable, Sendable {
    let lastRun: RssRun?
    let nextRunAt: String?
}

nonisolated struct RssRun: Decodable, Sendable {
    let status: String?
    let completedAt: String?
    let releasesFound: Int?
    let releasesGrabbed: Int?
    let releasesGrabbedByAi: Int?
    let error: String?
}

// MARK: - APNs device registration

nonisolated struct ApnsDeviceInfo: Encodable, Sendable {
    let deviceName: String?
    let osVersion: String?
    let appVersion: String?
    let bundleId: String?
}

nonisolated struct ApnsRegisterBody: Encodable, Sendable {
    let deviceToken: String
    let deviceInfo: ApnsDeviceInfo
}

// MARK: - SSO / OAuth providers

nonisolated struct SsoProvider: Decodable, Identifiable, Sendable {
    let slug: String
    let name: String
    let iconUrl: String?
    var id: String {
        slug
    }
}

nonisolated struct SsoProvidersResponse: Decodable, Sendable {
    let providers: [SsoProvider]
}

// MARK: - Notification center (spec §T3/T4/T5) — mirrors the web `/notifications` page.

/// The fields `NotificationLeadingVisual` (web) reads to pick an icon override
/// for `external` notifications. Other metadata keys are ignored on decode.
nonisolated struct NotificationMetadata: Decodable, Sendable {
    let serviceName: String?
    let mediaId: Int?
    let bookId: Int?
    let silent: Bool?
}

nonisolated struct NotificationDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let title: String
    let body: String
    let type: String
    let read: Bool
    let readAt: String?
    let url: String?
    let imageUrl: String?
    let metadata: NotificationMetadata?
    let createdAt: String
}

nonisolated struct NotificationsPagination: Decodable, Sendable {
    let page: Int
    let limit: Int
    let total: Int
    let pages: Int
}

nonisolated struct NotificationsResponseDTO: Decodable, Sendable {
    let notifications: [NotificationDTO]
    let pagination: NotificationsPagination?
}

nonisolated struct UnreadCountResponseDTO: Decodable, Sendable {
    let unreadCount: Int
}

/// A notification pushed live over `/api/notifications/stream`. The
/// connection's `{connected:true}` handshake has no `id` and so fails to
/// decode as this type — `APIClient.sseStream` drops it silently.
nonisolated struct StreamNotificationDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let title: String
    let body: String
    let type: String
    let url: String?
    let imageUrl: String?
    let metadata: NotificationMetadata?
}

// MARK: - Live library/book events (spec §T2)

/// Raw payload from `/api/library/events`: either the `{connected:true,ts}`
/// handshake, or a `{kind:"media",mediaId,ts}` / `{kind:"book",bookId,ts}`
/// update. An untagged `mediaId`-only payload (older server) is treated as a
/// media event by `APIClient.libraryEventsStream`.
nonisolated struct LibraryEventDTO: Decodable, Sendable {
    let connected: Bool?
    let kind: String?
    let mediaId: Int?
    let bookId: Int?
    let downloads: [DownloadProgressItemDTO]?
}

/// One row's pushed live progress inside a `download-progress` SSE event.
/// camelCase because SSE payloads are not snake-cased.
nonisolated struct DownloadProgressItemDTO: Decodable, Sendable {
    let id: Int
    let progress: Double
    let state: String
    let downloadSpeed: Double
    let etaSeconds: Int?
}

/// A download row's id paired with its latest live progress — what the detail
/// view overlays onto the row it already has.
nonisolated struct DownloadProgressEntry: Sendable {
    let id: Int
    let live: LiveDownload
}

/// A decoded library/book change with the connection handshake already
/// dropped — what `AppModel` actually reacts to.
enum LibraryEvent: Sendable {
    case media(id: Int)
    case book(id: Int)
    case downloadProgress(mediaId: Int, items: [DownloadProgressEntry])
    case handshake

    /// Map a decoded stream DTO to an event, applying the precedence the SSE
    /// consumer relies on: handshake, then live progress, then book, then the
    /// bare-`mediaId` media event an older server sends untagged. `nil` for a
    /// shape that carries nothing actionable.
    nonisolated static func from(_ dto: LibraryEventDTO) -> LibraryEvent? {
        if dto.connected == true {
            return .handshake
        }
        if dto.kind == "download-progress", let mediaId = dto.mediaId,
           let downloads = dto.downloads
        {
            let items = downloads.map { item in
                DownloadProgressEntry(
                    id: item.id,
                    live: LiveDownload(
                        progress: item.progress,
                        downloadSpeed: item.downloadSpeed,
                        etaSeconds: item.etaSeconds,
                        state: item.state
                    )
                )
            }
            return .downloadProgress(mediaId: mediaId, items: items)
        }
        if let bookId = dto.bookId, dto.kind == "book" {
            return .book(id: bookId)
        }
        if let mediaId = dto.mediaId {
            return .media(id: mediaId)
        }
        return nil
    }
}
