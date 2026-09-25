/// Outer margin and inner padding for the custom tab bar. The design's 16pt
/// margins give way on narrow screens so every slot stays a 44pt hit target.
public enum TabBarLayout {
    public struct Insets: Equatable, Sendable {
        public let margin: Double
        public let padding: Double
    }

    public static let minimumSlot = 44.0

    public static func insets(containerWidth: Double, slots: Int) -> Insets {
        let roomy = Insets(margin: 16, padding: 5)
        let needed = minimumSlot * Double(slots)
        if containerWidth - 2 * (roomy.margin + roomy.padding) >= needed {
            return roomy
        }
        let padding = 2.0
        let margin = min(roomy.margin, max(0, (containerWidth - needed) / 2 - padding))
        return Insets(margin: margin, padding: padding)
    }
}
