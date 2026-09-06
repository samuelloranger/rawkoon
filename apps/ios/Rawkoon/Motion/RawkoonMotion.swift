import SwiftUI

/// One motion vocabulary for the whole app. All timing derives from these
/// springs so the app reads as one system. Every consumer must be Reduce-Motion
/// safe — use `.rawkoonMotion(_:value:)` rather than `.animation` directly.
enum RawkoonMotion {
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static let snappy = Animation.spring(response: 0.3, dampingFraction: 0.9)
    static let gentle = Animation.easeInOut(duration: 0.25)
    /// Reduce-Motion replacement: a quick crossfade instead of movement.
    static let reduced = Animation.easeInOut(duration: 0.15)
}

extension View {
    /// Applies `animation` to `value`, degrading to a short crossfade under
    /// Reduce Motion. Prefer this over `.animation(_:value:)` everywhere.
    func rawkoonMotion(_ animation: Animation, value: some Equatable) -> some View {
        modifier(RawkoonMotionModifier(animation: animation, value: AnyEquatable(value)))
    }

    /// The apricot lamp: breathes while `active`, still otherwise.
    func breathingLamp(active: Bool) -> some View {
        modifier(BreathingLamp(isActive: active))
    }
}

private struct RawkoonMotionModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation
    let value: AnyEquatable
    func body(content: Content) -> some View {
        content.animation(reduceMotion ? RawkoonMotion.reduced : animation, value: value)
    }
}

/// Type-erased Equatable so the modifier can take any value.
///
/// The equality check is captured generically at init time (rather than via a
/// runtime `as? type(of: base))` cast on a metatype), so the comparison stays
/// type-safe under Swift 6's stricter existential/metatype casting rules.
private struct AnyEquatable: Equatable {
    let base: any Equatable
    private let isEqual: (any Equatable) -> Bool
    init<T: Equatable>(_ base: T) {
        self.base = base
        self.isEqual = { other in
            guard let other = other as? T else { return false }
            return other == base
        }
    }
    static func == (lhs: AnyEquatable, rhs: AnyEquatable) -> Bool { lhs.isEqual(rhs.base) }
}

struct BreathingLamp: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isActive: Bool
    @State private var phase = false
    func body(content: Content) -> some View {
        content
            .scaleEffect(breathe ? 1.03 : 1.0)
            .shadow(color: Theme.apricot.opacity(breathe ? 0.5 : 0.3),
                    radius: breathe ? 18 : 10)
            .onAppear { phase = isActive }
            .onChange(of: isActive) { _, now in phase = now }
            .animation(animation, value: breathe)
    }
    private var breathe: Bool { isActive && phase && !reduceMotion }
    private var animation: Animation {
        isActive && !reduceMotion
            ? .easeInOut(duration: 1.8).repeatForever(autoreverses: true)
            : RawkoonMotion.reduced
    }
}
