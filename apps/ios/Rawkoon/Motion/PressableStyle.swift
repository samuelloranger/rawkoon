import SwiftUI

extension EnvironmentValues {
    /// True under a modifier that already dims its disabled content, such as `requiresConnection` while offline.
    @Entry var rawkoonDisabledDimHandled = false
}

/// Opacity for a pressable control, pure so the rules are testable.
nonisolated enum PressableAppearance {
    static let pressedOpacity = 0.88
    static let disabledOpacity = 0.5

    /// A disabled control dims once: here, unless a modifier above it already did.
    static func opacity(isPressed: Bool, isEnabled: Bool, dimHandledAbove: Bool) -> Double {
        guard isEnabled else { return dimHandledAbove ? 1 : disabledOpacity }
        return isPressed ? pressedOpacity : 1
    }
}

/// Press feedback for tappable cards and rows: a quick shrink and dim, sprung back on release.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        PressableBody(configuration: configuration, scale: scale)
    }
}

private struct PressableBody: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.rawkoonDisabledDimHandled) private var dimHandledAbove
    let configuration: ButtonStyleConfiguration
    let scale: CGFloat

    var body: some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(PressableAppearance.opacity(
                isPressed: configuration.isPressed, isEnabled: isEnabled, dimHandledAbove: dimHandledAbove
            ))
            .animation(RawkoonMotion.snappy, value: configuration.isPressed)
            .animation(RawkoonMotion.reduced, value: isEnabled)
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
