import Foundation
import RawkoonKit

/// Where a notification's `url` or a `rawkoon://` deep link should take the
/// user, resolved to a concrete in-app screen.
///
/// The path table lives in `NotificationRoute` (Kit); any path without a
/// native screen resolves to `nil` and the caller stays on the current screen.
/// Never open a web view.
enum NotificationDestination: Identifiable, Equatable, Sendable {
    /// `/library/{mediaId}`, optionally `?season=&episode=&tab=management`.
    /// `mediaId` here is the library row id (not a TMDB id) — the resolving
    /// view fetches the full `LibraryMedia` before pushing `MediaDetailView`.
    case media(libraryId: Int, season: Int?, episode: Int?, focusManagement: Bool)
    /// `/books/{bookId}`.
    case book(bookId: Int)
    /// `/activity/requests`; opens the Requests lane of the Activity tab.
    case requests
    /// `/activity`; opens the Activity tab rather than a sheet.
    case inbox
    /// `/activity/calendar?date=`; opens the Activity tab rather than a sheet.
    case calendar(date: String?)
    /// `/activity/history`; opens the Activity tab rather than a sheet.
    case history
    /// `/activity/queue`.
    case queue
    /// `/find/watchlist` and the other Find shelves; opens the Find tab rather than a sheet.
    case findShelf(FindShelf)
    /// `/library/shelves/{id}`.
    case shelf(shelfId: Int)
    /// `/find/swipe`.
    case swipe
    /// `/settings/{page}` for a page that is one screen.
    case settings(SettingsDestination)
    /// `/settings/{page}` for a page that lists several screens.
    case settingsGroup(SettingsGroup)
    /// `/settings/profile`.
    case profile
    /// A tab root such as `/library`; switches tabs rather than presenting a sheet.
    case tab(RootTab)

    var id: String {
        switch self {
        case let .media(libraryId, season, episode, focusManagement):
            "media-\(libraryId)-\(season.map(String.init) ?? "-")-\(episode.map(String.init) ?? "-")-\(focusManagement)"
        case let .book(bookId):
            "book-\(bookId)"
        case .requests:
            "requests"
        case .inbox:
            "inbox"
        case let .calendar(date):
            "calendar-\(date ?? "-")"
        case .history:
            "history"
        case .queue:
            "queue"
        case let .findShelf(shelf):
            "find-\(shelf.rawValue)"
        case let .shelf(shelfId):
            "shelf-\(shelfId)"
        case .swipe:
            "swipe"
        case let .settings(destination):
            "settings-\(destination.rawValue)"
        case let .settingsGroup(group):
            "settings-group-\(group.rawValue)"
        case .profile:
            "profile"
        case let .tab(tab):
            "tab-\(tab.rawValue)"
        }
    }

    /// Parses a web SPA path (such as `/library/42?season=2&tab=management`)
    /// into a native destination. Returns `nil` for an empty/missing url or any
    /// path this app doesn't have a screen for.
    static func resolve(url: String?) -> NotificationDestination? {
        switch NotificationRoute.parse(url) {
        case let .media(libraryId, season, episode, focusManagement)?:
            .media(libraryId: libraryId, season: season, episode: episode, focusManagement: focusManagement)
        case let .book(bookId)?: .book(bookId: bookId)
        case let .calendar(date)?: .calendar(date: date)
        case .requests?: .requests
        case .inbox?: .inbox
        case .history?: .history
        case .queue?: .queue
        case let .findShelf(shelf)?: .findShelf(shelf)
        case let .shelf(shelfId)?: .shelf(shelfId: shelfId)
        case .swipe?: .swipe
        case let .settings(page)?: settings(page: page)
        case let .tab(tab)?: .tab(tab)
        case nil: nil
        }
    }

    /// A web settings slug, or an app screen or page id, as the screen it opens.
    private static func settings(page: String) -> NotificationDestination? {
        switch page {
        case "profile": return .profile
        case "app": return .settings(.appPreferences)
        // The download-client-offline alert links to Connections.
        case "connections": return .settings(.downloadClient)
        case "after-download": return .settings(.seeding)
        case "downloads": return .settings(.arrImport)
        case "ai-usage": return .settings(.aiUsage)
        case "updates": return .settings(.releases)
        default: break
        }
        if let group = SettingsGroup(rawValue: page), group != .system {
            let screens = group.destinations
            return screens.count == 1 ? .settings(screens[0]) : .settingsGroup(group)
        }
        return SettingsDestination(rawValue: page).map { .settings($0) }
    }

    /// Server settings a non-admin can't open.
    var isAdminOnly: Bool {
        switch self {
        case let .settings(destination): destination.isAdminOnly
        case .settingsGroup: true
        default: false
        }
    }

    /// The tab that hosts this destination, for the ones that are not a pushed screen.
    var hostTab: RootTab? {
        switch self {
        case .inbox, .requests, .calendar, .history: .activity
        case .findShelf: .find
        case let .tab(tab): tab
        default: nil
        }
    }

    /// The Activity lane a tab-hosted destination opens on.
    var activityLane: ActivityLane? {
        switch self {
        case .inbox: .inbox
        case .requests: .requests
        case .calendar: .calendar
        case .history: .history
        default: nil
        }
    }
}
