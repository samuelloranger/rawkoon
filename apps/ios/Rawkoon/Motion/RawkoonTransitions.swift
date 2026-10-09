import SwiftUI

/// Skeleton → content and state switches: a soft blur-scale crossfade.
struct RawkoonSwapTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(SwapEffect(isIdentity: phase.isIdentity))
    }
}

/// Banners, errors and expanding sections: a short slide down from above.
struct RawkoonRevealTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(RevealEffect(isIdentity: phase.isIdentity))
    }
}

extension Transition where Self == RawkoonSwapTransition {
    static var rawkoonSwap: RawkoonSwapTransition {
        RawkoonSwapTransition()
    }
}

extension Transition where Self == RawkoonRevealTransition {
    static var rawkoonReveal: RawkoonRevealTransition {
        RawkoonRevealTransition()
    }
}

private struct SwapEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isIdentity: Bool

    func body(content: Content) -> some View {
        let still = isIdentity || reduceMotion
        content
            .opacity(isIdentity ? 1 : 0)
            .scaleEffect(still ? 1 : 0.98)
            .blur(radius: still ? 0 : 6)
    }
}

private struct RevealEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isIdentity: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isIdentity ? 1 : 0)
            .offset(y: isIdentity || reduceMotion ? 0 : -12)
    }
}
