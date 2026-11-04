import Foundation

/// Where a notification's `url` points, parsed from the web SPA path the server
/// emits. Pure so the path table is unit-tested on Linux; the app maps each
/// case to a screen. Anything the app has no screen for parses to nil. Paths
/// from before the restructure still resolve, so already-delivered pushes and
/// an older server keep working.
public enum NotificationRoute: Equatable, Sendable {
    /// `/library/{id}`, optionally `?season=&episode=&tab=files` (the web's Files tab).
    /// `tab=management` from older pushes still counts.
    case media(libraryId: Int, season: Int?, episode: Int?, focusManagement: Bool)
    /// `/books/{id}`.
    case book(bookId: Int)
    /// `/activity` (the inbox itself), or the old `/notifications`.
    case inbox
    /// `/activity/requests`, or the old `/requests`.
    case requests
    /// `/activity/calendar`, optionally `?date=`, or the old `/calendar`.
    case calendar(date: String?)
    /// `/find/watchlist`, or the old `/watchlist`.
    case watchlist
    /// `/settings/reencode`, or the old `/settings?tab=transcode`.
    case reencode
    /// `/settings/alerts`, or the old `/settings?tab=notifications`.
    case alerts
    /// `/settings/updates`, or the old `/settings?tab=releases`.
    case updates
    /// `/settings/connections`, where the download client is set up.
    case downloadClient

    public static func parse(_ url: String?) -> NotificationRoute? {
        guard let url, !url.isEmpty, let components = URLComponents(string: url) else { return nil }
        let segments = components.path.split(separator: "/").map(String.init)
        guard let head = segments.first else { return nil }

        func query(_ name: String) -> String? {
            components.queryItems?.first(where: { $0.name == name })?.value
        }

        switch (head, segments.dropFirst().first) {
        case let ("library", id?):
            let focusFiles = query("tab").map { ["files", "management"].contains($0) } ?? false
            return Int(id).map {
                .media(
                    libraryId: $0, season: query("season").flatMap(Int.init),
                    episode: query("episode").flatMap(Int.init), focusManagement: focusFiles
                )
            }
        case let ("books", id?):
            return Int(id).map { .book(bookId: $0) }
        case ("activity", "calendar"), ("calendar", nil): return .calendar(date: query("date"))
        case ("settings", nil): return legacySettings(tab: query("tab"))
        default: return pageRoute(head, segments.dropFirst().first)
        }
    }

    /// The pages whose route depends on the path alone.
    private static func pageRoute(_ head: String, _ second: String?) -> NotificationRoute? {
        switch (head, second) {
        case ("activity", nil), ("notifications", nil): .inbox
        case ("activity", "requests"), ("requests", nil): .requests
        case ("find", "watchlist"), ("watchlist", nil): .watchlist
        case ("settings", "reencode"): .reencode
        case ("settings", "alerts"): .alerts
        case ("settings", "updates"): .updates
        case ("settings", "connections"): .downloadClient
        default: nil
        }
    }

    /// The old `/settings?tab=` links still stored on past notifications.
    private static func legacySettings(tab: String?) -> NotificationRoute? {
        switch tab {
        case "transcode": .reencode
        case "notifications": .alerts
        case "releases": .updates
        default: nil
        }
    }
}
