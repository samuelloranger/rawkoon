/// The app's top-level destinations. Raw values are the tab tags persisted in
/// selection state, so they must not change.
public enum RootTab: String, CaseIterable, Sendable {
    case home, library, books, discover, explore, notifications, settings

    /// The custom iPhone bar, left to right.
    public static let phone: [RootTab] = [.home, .library, .books, .discover, .explore, .notifications, .settings]

    /// The iPad/Mac sidebar, which the custom bar does not change.
    public static let sidebar: [RootTab] = [.home, .library, .books, .discover, .explore, .settings]

    /// A stale pick must resolve to a tab that exists at this width; Home is the landing tab.
    public static func validated(_ raw: String, compact: Bool) -> RootTab {
        guard let tab = RootTab(rawValue: raw), (compact ? phone : sidebar).contains(tab) else { return .home }
        return tab
    }

    /// The debug `RAWKOON_TAB` value: a tab name, or one of the five indices
    /// screenshot scripts used before the custom bar, with their old meaning.
    public static func debugSelection(_ raw: String) -> RootTab? {
        if let tab = RootTab(rawValue: raw) {
            return tab
        }
        let legacy: [RootTab] = [.home, .library, .books, .discover, .settings]
        guard let index = Int(raw), legacy.indices.contains(index) else { return nil }
        return legacy[index]
    }
}
