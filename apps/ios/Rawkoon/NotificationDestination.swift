import Foundation

/// Where a notification's `url` should take the user, resolved to a concrete
/// in-app screen.
///
/// iOS has no general path router — this is a bounded mapper, not one. Only
/// the paths the server actually emits (see `buildLibraryNotificationUrl` /
/// `buildNotificationUrl` on the web side) are mapped; anything else resolves
/// to `nil` and the caller stays on the current screen. Never open a web view.
enum NotificationDestination: Identifiable, Equatable, Sendable {
    /// `/library/{mediaId}`, optionally `?season=&episode=&tab=management`.
    /// `mediaId` here is the library row id (not a TMDB id) — the resolving
    /// view fetches the full `LibraryMedia` before pushing `MediaDetailView`.
    case media(libraryId: Int, season: Int?, episode: Int?, focusManagement: Bool)
    /// `/books/{bookId}`.
    case book(bookId: Int)
    /// `/requests`.
    case requests

    var id: String {
        switch self {
        case let .media(libraryId, season, episode, focusManagement):
            "media-\(libraryId)-\(season.map(String.init) ?? "-")-\(episode.map(String.init) ?? "-")-\(focusManagement)"
        case let .book(bookId):
            "book-\(bookId)"
        case .requests:
            "requests"
        }
    }

    /// Parses a notification `url` (a web SPA path such as
    /// `/library/42?season=2&tab=management`) into a native destination.
    /// Returns `nil` for an empty/missing url, `/notifications` (the list
    /// itself), or any path this app doesn't have a screen for.
    static func resolve(url: String?) -> NotificationDestination? {
        guard let url, !url.isEmpty else { return nil }
        guard let components = URLComponents(string: url) else { return nil }

        let segments = components.path.split(separator: "/").map(String.init)
        guard let head = segments.first else { return nil }

        func queryInt(_ name: String) -> Int? {
            components.queryItems?.first(where: { $0.name == name })?.value.flatMap(Int.init)
        }

        switch head {
        case "library":
            guard segments.count >= 2, let libraryId = Int(segments[1]) else { return nil }
            let focusManagement = components.queryItems?.first(where: { $0.name == "tab" })?.value == "management"
            return .media(
                libraryId: libraryId, season: queryInt("season"), episode: queryInt("episode"),
                focusManagement: focusManagement
            )
        case "books":
            guard segments.count >= 2, let bookId = Int(segments[1]) else { return nil }
            return .book(bookId: bookId)
        case "requests":
            return .requests
        default:
            // Includes "notifications" (the list itself) and anything unknown.
            return nil
        }
    }
}
