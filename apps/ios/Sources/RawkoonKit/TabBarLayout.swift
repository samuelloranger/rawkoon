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

    public struct Size: Equatable, Sendable {
        public let width: Double
        public let height: Double

        public init(width: Double, height: Double) {
            self.width = width
            self.height = height
        }
    }

    public struct Frame: Equatable, Sendable {
        public let x: Double
        public let y: Double
        public let width: Double
        public let height: Double

        public init(x: Double, y: Double, width: Double, height: Double) {
            self.x = x
            self.y = y
            self.width = width
            self.height = height
        }
    }

    public struct Chrome: Equatable, Sendable {
        public let height: Double
        public let bar: Frame
        public let miniPlayer: Frame?
    }

    /// Places the bar and mini player in one fixed-height box, so collapsing moves
    /// the same mini player instead of swapping it between two containers.
    /// Expanded, it spans the width above the bar; collapsed, it fills the rest of
    /// the bar's row, centred on the bar.
    public static func chrome(
        width: Double, bar: Size, miniPlayerHeight: Double?, collapsed: Bool, spacing: Double = 8
    ) -> Chrome {
        guard let mini = miniPlayerHeight else {
            return Chrome(height: bar.height, bar: Frame(x: 0, y: 0, width: bar.width, height: bar.height), miniPlayer: nil)
        }
        let height = mini + spacing + bar.height
        let barY = height - bar.height
        let barFrame = Frame(x: 0, y: barY, width: bar.width, height: bar.height)
        let miniFrame = collapsed
            ? Frame(x: bar.width + spacing, y: barY + (bar.height - mini) / 2,
                    width: width - bar.width - spacing, height: mini)
            : Frame(x: 0, y: 0, width: width, height: mini)
        return Chrome(height: height, bar: barFrame, miniPlayer: miniFrame)
    }
}
