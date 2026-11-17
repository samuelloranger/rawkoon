import Foundation

/// Where a web SPA path points, parsed for a notification's `url` or a
/// `rawkoon://` deep link. Pure so the path table is unit-tested on Linux; the
/// app maps each case to a screen. Anything the app has no screen for parses to
/// nil. Paths from before the restructure still resolve, so already-delivered
/// pushes and an older server keep working.
public enum NotificationRoute: Equatable, Sendable {
    /// `/library/{id}`, optionally `?season=&episode=&tab=files` (the web's Files tab).
    /// `tab=management` from older pushes still counts.
    case media(libraryId: Int, season: Int?, episode: Int?, focusManagement: Bool)
    /// `/books/{id}`, and its `/listen` and `/read` pages.
    case book(bookId: Int)
    /// `/activity` (the inbox itself), or the old `/notifications`.
    case inbox
    /// `/activity/requests`, or the old `/requests`.
    case requests
    /// `/activity/calendar`, optionally `?date=`, or the old `/calendar`.
    case calendar(date: String?)
    /// `/activity/history`.
    case history
    /// `/activity/queue`.
    case queue
    /// `/find/watchlist`, `/find/collections`, `/find/bestsellers`, `/library/shelves`, or the old `/watchlist`.
    case findShelf(FindShelf)
    /// `/library/shelves/{id}`.
    case shelf(shelfId: Int)
    /// `/find/swipe`.
    case swipe
    /// `/settings/{page}`; the app decides which pages it has. Old `/settings?tab=` links map to today's page.
    case settings(page: String)
    /// A tab root: `/`, `/library`, `/books`, `/find`, `/settings`.
    case tab(RootTab)

    public static func parse(_ url: String?) -> NotificationRoute? {
        guard let url, !url.isEmpty, let components = URLComponents(string: url) else { return nil }
        let segments = components.path.split(separator: "/").map(String.init)
        guard let head = segments.first else { return url.hasPrefix("/") ? .tab(.home) : nil }

        func query(_ name: String) -> String? {
            components.queryItems?.first(where: { $0.name == name })?.value
        }

        switch (head, segments.dropFirst().first) {
        case ("library", "shelves"):
            guard segments.count > 2 else { return .findShelf(.shelves) }
            return Int(segments[2]).map { .shelf(shelfId: $0) }
        case let ("library", id?):
            let focusFiles = query("tab").map { ["files", "management"].contains($0) } ?? false
            return Int(id).map {
                .media(
                    libraryId: $0, season: query("season").flatMap(Int.init),
                    episode: query("episode").flatMap(Int.init), focusManagement: focusFiles
                )
            }
        case let ("books", id?):
            return Int(id).map { .book(bookId: $0) } ?? .tab(.books)
        case ("activity", "calendar"), ("calendar", nil): return .calendar(date: query("date"))
        case ("settings", nil): return legacySettings(tab: query("tab"))
        case let ("settings", page?): return .settings(page: page)
        default: return pageRoute(head, segments.dropFirst().first)
        }
    }

    /// A `rawkoon://` deep link as the web path it stands for: `rawkoon://library/42?season=2`
    /// is `/library/42?season=2`, so any web URL works with its origin swapped for `rawkoon://`.
    public static func webPath(fromAppURL url: URL) -> String? {
        guard url.scheme == "rawkoon",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let segments = [components.host ?? ""] + components.path.split(separator: "/").map(String.init)
        let path = "/" + segments.filter { !$0.isEmpty }.joined(separator: "/")
        return path + (components.percentEncodedQuery.map { "?\($0)" } ?? "")
    }

    /// The pages whose route depends on the path alone.
    // swiftlint:disable:next cyclomatic_complexity
    private static func pageRoute(_ head: String, _ second: String?) -> NotificationRoute? {
        switch (head, second) {
        case ("activity", nil), ("notifications", nil): .inbox
        case ("activity", "requests"), ("requests", nil): .requests
        case ("activity", "history"): .history
        case ("activity", "queue"): .queue
        case ("find", "watchlist"), ("watchlist", nil): .findShelf(.watchlist)
        case ("find", "collections"): .findShelf(.collections)
        case ("find", "bestsellers"): .findShelf(.bestsellers)
        case ("find", "swipe"): .swipe
        case ("find", nil), ("discover", nil): .tab(.find)
        case ("home", nil): .tab(.home)
        case ("library", nil): .tab(.library)
        case ("books", nil): .tab(.books)
        default: nil
        }
    }

    /// The old `/settings?tab=` links still stored on past notifications; a bare `/settings` is the tab.
    private static func legacySettings(tab: String?) -> NotificationRoute? {
        switch tab {
        case "transcode": .settings(page: "reencode")
        case "notifications": .settings(page: "alerts")
        case "releases": .settings(page: "updates")
        case nil: .tab(.settings)
        default: nil
        }
    }
}
