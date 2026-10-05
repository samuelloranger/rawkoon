import RawkoonKit
import SwiftUI

extension RootTab {
    var symbol: String {
        switch self {
        case .home: "house"
        case .library: "film.stack"
        case .books: "books.vertical"
        case .discover: "sparkles.rectangle.stack"
        case .explore: "square.grid.2x2"
        case .notifications: "bell"
        case .settings: "gearshape"
        case .activity: "arrow.down.circle"
        case .requests: "tray.and.arrow.down"
        case .watchlist: "bookmark"
        case .server: "server.rack"
        }
    }

    var selectedSymbol: String {
        self == .settings ? symbol : symbol + ".fill"
    }

    var title: LocalizedStringKey {
        switch self {
        case .home: "Home"
        case .library: "Media"
        case .books: "Books"
        case .discover: "Discover"
        case .explore: "Explore"
        case .notifications: "Notifications"
        case .settings: "Settings"
        case .activity: "Activity"
        case .requests: "Requests"
        case .watchlist: "Watchlist"
        case .server: "Server"
        }
    }

    /// Sidebar and menu label: the phone bar abbreviates Movies & Shows to fit.
    var sidebarTitle: LocalizedStringKey {
        self == .library ? "Movies & Shows" : title
    }
}
