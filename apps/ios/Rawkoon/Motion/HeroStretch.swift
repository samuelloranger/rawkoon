import Observation
import SwiftUI

/// Scroll-driven geometry for a detail hero: pull down to stretch, scroll up to parallax and fade.
enum HeroStretch {
    nonisolated struct Transform: Equatable, Sendable {
        var scale: CGFloat
        var offsetY: CGFloat
        var opacity: Double
    }

    /// Past any hero's height, so a clamped pull leaves the hero fully clipped and stops scroll updates.
    nonisolated static let trackedDepth: CGFloat = 600

    /// `minY` is the hero's top edge relative to its rest position; positive while overscrolled.
    nonisolated static func transform(minY: CGFloat, height: CGFloat) -> Transform {
        guard height > 0 else { return Transform(scale: 1, offsetY: 0, opacity: 1) }
        if minY > 0 {
            return Transform(scale: 1 + minY / height, offsetY: 0, opacity: 1)
        }
        let progress = min(1, -minY / height)
        return Transform(scale: 1, offsetY: -minY / 2, opacity: 1 - Double(progress) * 0.6)
    }

    /// The host scroll view's distance from rest, from its own geometry, so a top inset never reads as a pull.
    nonisolated static func pull(contentOffsetY: CGFloat, insetTop: CGFloat) -> CGFloat {
        max(-trackedDepth, -(contentOffsetY + insetTop))
    }
}

/// Written by the host on each scroll frame and read only by the hero, so scrolling re-renders the hero alone.
@Observable
final class HeroScroll {
    var pull: CGFloat = 0
}

/// Delays for a detail header's cascade: wait out what is left of the zoom push, then step through the parts.
nonisolated enum HeroLanding {
    /// Roughly how long a zoom push takes to land.
    static let settle = 0.3
    static let beat = 0.06

    static func delay(step: Int, elapsed: TimeInterval) -> Double {
        max(0, settle - max(0, elapsed)) + Double(min(max(step, 0), 3)) * beat
    }
}

extension EnvironmentValues {
    @Entry var rawkoonHeroScroll: HeroScroll?
    /// When the screen hosting a landing cascade first appeared (system uptime); nil reads as "just now".
    @Entry var rawkoonLandingOrigin: TimeInterval?
}

extension View {
    /// Goes on the ScrollView that holds a `rawkoonStretchyHero`; it measures the pull the hero follows.
    func rawkoonStretchyHeroHost() -> some View {
        modifier(StretchyHeroHost())
    }

    /// Stretches on pull-down and parallaxes on scroll, clipped below its bottom edge; static under Reduce Motion.
    /// `fileID` and `line` only name the call site in the DEBUG missing-host log.
    func rawkoonStretchyHero(height: CGFloat, fileID: String = #fileID, line: Int = #line) -> some View {
        StretchyHeroLayer(content: self, height: height, callSite: "\(fileID):\(line)")
    }

    /// Fades and rises this header piece in once, `step` beats after the screen's zoom push lands.
    func rawkoonLanding(step: Int) -> some View {
        modifier(Landing(step: step))
    }
}

private struct StretchyHeroHost: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scroll = HeroScroll()

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                HeroStretch.pull(contentOffsetY: geometry.contentOffset.y, insetTop: geometry.contentInsets.top)
            } action: { _, pull in
                // The hero is static under Reduce Motion, so skip the per-frame writes.
                guard !reduceMotion else { return }
                scroll.pull = pull
            }
            .environment(\.rawkoonHeroScroll, scroll)
    }
}

private struct StretchyHeroLayer<Content: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.rawkoonHeroScroll) private var scroll
    let content: Content
    let height: CGFloat
    let callSite: String

    var body: some View {
        // Reading `pull` here subscribes this layer, and nothing above it, to scrolling.
        let transform = HeroStretch.transform(minY: reduceMotion ? 0 : scroll?.pull ?? 0, height: height)
        content
            .scaleEffect(transform.scale, anchor: .bottom)
            .offset(y: transform.offsetY)
            .opacity(transform.opacity)
            .clipShape(BelowEdgeClip())
            .onAppear {
                #if DEBUG
                    if scroll == nil {
                        MissingHeroHost.report(callSite)
                    }
                #endif
            }
    }
}

/// Clips the sides and the bottom but not the top, so a stretch grows upward while parallax never covers what follows.
private nonisolated struct BelowEdgeClip: Shape {
    func path(in rect: CGRect) -> Path {
        let headroom: CGFloat = 10000
        return Path(CGRect(x: rect.minX, y: rect.minY - headroom, width: rect.width, height: rect.height + headroom))
    }
}

private struct Landing: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.rawkoonLandingOrigin) private var origin
    let step: Int
    @State private var landed = false

    func body(content: Content) -> some View {
        content
            .opacity(landed ? 1 : 0)
            .offset(y: landed || reduceMotion ? 0 : 10)
            .onAppear {
                guard !landed else { return }
                let now = ProcessInfo.processInfo.systemUptime
                let delay = HeroLanding.delay(step: step, elapsed: origin.map { now - $0 } ?? 0)
                let animation = reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.spring.delay(delay)
                withAnimation(animation) { landed = true }
            }
    }
}

#if DEBUG
    /// Without a host the hero never moves; say so once per call site.
    private enum MissingHeroHost {
        private static var reported: Set<String> = []

        static func report(_ callSite: String) {
            guard reported.insert(callSite).inserted else { return }
            Log.motion.warning(
                """
                rawkoonStretchyHero at \(callSite, privacy: .public) has no rawkoonStretchyHeroHost \
                on its ScrollView; it stays static
                """
            )
        }
    }
#endif
