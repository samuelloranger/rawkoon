import Foundation
import RawkoonKit

/// Where a notification's `url` should take the user, resolved to a concrete
/// in-app screen.
///
/// iOS has no general path router — this is a bounded mapper, not one. The
/// path table lives in `NotificationRoute` (Kit); only paths the server
/// actually emits are mapped, anything else resolves to `nil` and the caller
/// stays on the current screen. Never open a web view.
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
    /// `/find/watchlist`; opens the Find tab rather than a sheet.
    case watchlist
    /// `/settings/reencode` (re-encode finished / failed).
    case reencode
    /// `/settings/alerts` (notification preferences).
    case alerts
    /// `/settings/updates` (app updates).
    case updates
    /// `/settings/connections` (download client offline).
    case downloadClient

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
        case .watchlist:
            "watchlist"
        case .reencode:
            "reencode"
        case .alerts:
            "alerts"
        case .updates:
            "updates"
        case .downloadClient:
            "download-client"
        }
    }

    /// Parses a notification `url` (a web SPA path such as
    /// `/library/42?season=2&tab=management`) into a native destination.
    /// Returns `nil` for an empty/missing url, `/activity` (the inbox itself),
    /// or any path this app doesn't have a screen for.
    static func resolve(url: String?) -> NotificationDestination? {
        switch NotificationRoute.parse(url) {
        case let .media(libraryId, season, episode, focusManagement)?:
            .media(libraryId: libraryId, season: season, episode: episode, focusManagement: focusManagement)
        case let .book(bookId)?: .book(bookId: bookId)
        case let .calendar(date)?: .calendar(date: date)
        case let route?: page(route)
        case nil: nil
        }
    }

    /// The routes without parameters, which map one to one.
    private static func page(_ route: NotificationRoute) -> NotificationDestination? {
        switch route {
        case .requests: .requests
        case .inbox: .inbox
        case .watchlist: .watchlist
        case .reencode: .reencode
        case .alerts: .alerts
        case .updates: .updates
        case .downloadClient: .downloadClient
        case .media, .book, .calendar: nil
        }
    }

    /// The tab that hosts this destination, for the ones that are not a pushed screen.
    var hostTab: RootTab? {
        switch self {
        case .inbox, .requests, .calendar: .activity
        case .watchlist: .find
        default: nil
        }
    }

    /// The Activity lane a tab-hosted destination opens on.
    var activityLane: ActivityLane? {
        switch self {
        case .inbox: .inbox
        case .requests: .requests
        case .calendar: .calendar
        default: nil
        }
    }
}
