import SwiftUI

/// Press feedback for tappable cards and rows: a quick shrink and dim, sprung back on release.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        PressableBody(configuration: configuration, scale: scale)
    }
}

private struct PressableBody: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let configuration: ButtonStyleConfiguration
    let scale: CGFloat

    var body: some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(RawkoonMotion.snappy, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var rawkoonPressable: PressableStyle {
        PressableStyle()
    }

    /// Full-width rows use a gentler 0.98 so a wide shrink doesn't read as a jump.
    static func rawkoonPressable(scale: CGFloat) -> PressableStyle {
        PressableStyle(scale: scale)
    }
}
