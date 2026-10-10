import SwiftUI

/// Skeleton → content and state switches: a plain crossfade; scale or blur on text reads as a wobble.
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

/// Content that replaces a sibling: slides a short way in from `edge`, and leaves by fading in place.
struct RawkoonSlideTransition: Transition {
    let edge: Edge

    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(SlideEffect(phase: phase, edge: edge))
    }
}

extension Transition where Self == RawkoonSlideTransition {
    static func rawkoonSlide(_ edge: Edge) -> RawkoonSlideTransition {
        RawkoonSlideTransition(edge: edge)
    }
}

/// Geometry for `rawkoonSlide`; only the entering view moves, because a leaving view's edge comes from a stale render.
nonisolated enum RawkoonSlide {
    static let distance: CGFloat = 28

    /// A tab or lane to the right of the current one enters from the trailing side.
    static func edge(from old: Int, to new: Int) -> Edge {
        new >= old ? .trailing : .leading
    }

    static func offset(edge: Edge, appearing: Bool, reduceMotion: Bool) -> CGSize {
        guard appearing, !reduceMotion else { return .zero }
        let sign: CGFloat = edge == .leading || edge == .top ? -1 : 1
        let horizontal = edge == .leading || edge == .trailing
        return horizontal
            ? CGSize(width: sign * distance, height: 0)
            : CGSize(width: 0, height: sign * distance)
    }
}

/// Small marks (an unread dot, a badge, a check) that pop in and out.
struct RawkoonPopTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(PopEffect(isIdentity: phase.isIdentity))
    }
}

extension Transition where Self == RawkoonPopTransition {
    static var rawkoonPop: RawkoonPopTransition {
        RawkoonPopTransition()
    }
}

/// Scale for `rawkoonPop`; a plain fade under Reduce Motion.
nonisolated enum RawkoonPop {
    static let hiddenScale: CGFloat = 0.3

    static func scale(isIdentity: Bool, reduceMotion: Bool) -> CGFloat {
        isIdentity || reduceMotion ? 1 : hiddenScale
    }
}

private struct SwapEffect: ViewModifier {
    let isIdentity: Bool

    func body(content: Content) -> some View {
        content.opacity(isIdentity ? 1 : 0)
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
                let vertical: CGFloat = edge == .top ? -proxy.size.height : proxy.size.height
                let horizontal: CGFloat = edge == .leading ? -proxy.size.width : proxy.size.width
                let isVertical = edge == .top || edge == .bottom
                let shift = CGSize(
                    width: slides && !isVertical ? horizontal : 0,
                    height: slides && isVertical ? vertical : 0
                )
                return view.offset(shift)
            }
    }
}

private struct SlideEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let phase: TransitionPhase
    let edge: Edge

    func body(content: Content) -> some View {
        let appearing = switch phase {
        case .willAppear: true
        default: false
        }
        content
            .opacity(phase.isIdentity ? 1 : 0)
            .offset(RawkoonSlide.offset(edge: edge, appearing: appearing, reduceMotion: reduceMotion))
    }
}

private struct PopEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isIdentity: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isIdentity ? 1 : 0)
            .scaleEffect(RawkoonPop.scale(isIdentity: isIdentity, reduceMotion: reduceMotion))
    }
}
