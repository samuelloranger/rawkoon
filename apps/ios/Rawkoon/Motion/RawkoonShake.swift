import SwiftUI

/// Keyframe offsets for `rawkoonShake`: a quick side-to-side that decays and ends at rest.
nonisolated enum RawkoonShake {
    static let offsets: [CGFloat] = [-10, 8, -6, 3, 0]
    static let beat = 0.07
}

extension View {
    /// Shakes side to side and plays `haptic` when `trigger` changes; only the haptic under Reduce Motion.
    /// Pass `when` to shake on some changes only, e.g. `{ $1 != nil }` for a new error.
    func rawkoonShake<Trigger: Equatable>(
        trigger: Trigger,
        haptic: RawkoonHaptics.Event? = .error,
        when predicate: ((Trigger, Trigger) -> Bool)? = nil
    ) -> some View {
        modifier(Shake(trigger: trigger, haptic: haptic, predicate: predicate))
    }
}

private struct ShakeFrame {
    var offsetX: CGFloat = 0
}

private struct Shake<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger
    let haptic: RawkoonHaptics.Event?
    let predicate: ((Trigger, Trigger) -> Bool)?
    /// Counts accepted trigger changes; the animator and the haptic key off this, not the raw trigger.
    @State private var fires = 0

    func body(content: Content) -> some View {
        // Copied out so the nonisolated animator closures read no MainActor state.
        let moves = !reduceMotion
        let offsets = RawkoonShake.offsets
        let beat = RawkoonShake.beat
        let haptic = haptic
        return content
            .keyframeAnimator(initialValue: ShakeFrame(), trigger: fires) { view, frame in
                view.offset(x: moves ? frame.offsetX : 0)
            } keyframes: { _ in
                KeyframeTrack(\.offsetX) {
                    CubicKeyframe(offsets[0], duration: beat)
                    CubicKeyframe(offsets[1], duration: beat)
                    CubicKeyframe(offsets[2], duration: beat)
                    CubicKeyframe(offsets[3], duration: beat)
                    CubicKeyframe(offsets[4], duration: beat)
                }
            }
            .sensoryFeedback(RawkoonHaptics.feedback(for: haptic ?? .error), trigger: fires) { _, _ in
                haptic != nil
            }
            .onChange(of: trigger) { old, new in
                if CelebrationGate.fires(from: old, to: new, when: predicate) {
                    fires += 1
                }
            }
    }
}
