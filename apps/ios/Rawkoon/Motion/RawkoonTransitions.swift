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

/// Chrome that enters from an edge: slides fully past it, or just fades under Reduce Motion.
struct RawkoonEdgeTransition: Transition {
    let edge: Edge

    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(EdgeEffect(isIdentity: phase.isIdentity, edge: edge))
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

extension Transition where Self == RawkoonEdgeTransition {
    static func rawkoonEdge(_ edge: Edge) -> RawkoonEdgeTransition {
        RawkoonEdgeTransition(edge: edge)
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

private struct EdgeEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isIdentity: Bool
    let edge: Edge

    func body(content: Content) -> some View {
        let slides = !isIdentity && !reduceMotion
        let edge = edge
        content
            .opacity(isIdentity ? 1 : 0)
            .visualEffect { view, proxy in
                let dy: CGFloat = !slides ? 0 : edge == .top ? -proxy.size.height : edge == .bottom ? proxy.size.height : 0
                let dx: CGFloat = !slides ? 0 : edge == .leading ? -proxy.size.width : edge == .trailing ? proxy.size.width : 0
                return view.offset(x: dx, y: dy)
            }
    }
}
