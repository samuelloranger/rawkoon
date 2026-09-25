/// The app's top-level destinations. Raw values are the tab tags persisted in
/// selection state, so they must not change.
public enum RootTab: String, CaseIterable, Sendable {
    case home, library, books, discover, explore, notifications, settings

    /// The custom iPhone bar, left to right.
    public static let phone: [RootTab] = [.home, .library, .books, .discover, .explore, .notifications, .settings]

    /// The iPad/Mac sidebar, which the custom bar does not change.
    public static let sidebar: [RootTab] = [.home, .library, .books, .discover, .explore, .settings]

    /// A stale pick must resolve to a tab that exists at this width.
    public static func validated(_ raw: String, compact: Bool) -> RootTab {
        guard let tab = RootTab(rawValue: raw) else { return .library }
        return (compact ? phone : sidebar).contains(tab) ? tab : .home
    }
}
