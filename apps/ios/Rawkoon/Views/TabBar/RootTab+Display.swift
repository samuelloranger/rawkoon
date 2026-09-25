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
        }
    }
}
