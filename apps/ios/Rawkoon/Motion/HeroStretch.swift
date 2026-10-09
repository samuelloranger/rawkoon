import SwiftUI

/// Scroll-driven geometry for a detail hero: pull down to stretch, scroll up to parallax and fade.
enum HeroStretch {
    nonisolated struct Transform: Equatable, Sendable {
        var scale: CGFloat
        var offsetY: CGFloat
        var opacity: Double
    }

    /// `minY` is the hero's top edge in scroll-view space; positive while overscrolled.
    nonisolated static func transform(minY: CGFloat, height: CGFloat) -> Transform {
        guard height > 0 else { return Transform(scale: 1, offsetY: 0, opacity: 1) }
        if minY > 0 {
            return Transform(scale: 1 + minY / height, offsetY: 0, opacity: 1)
        }
        let progress = min(1, -minY / height)
        return Transform(scale: 1, offsetY: -minY / 2, opacity: 1 - Double(progress) * 0.6)
    }
}

extension View {
    /// Stretches on pull-down and parallaxes on scroll; static under Reduce Motion.
    func rawkoonStretchyHero(height: CGFloat) -> some View {
        modifier(StretchyHero(height: height))
    }
}

private struct StretchyHero: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let height: CGFloat

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            let height = height
            content.visualEffect { view, proxy in
                let transform = HeroStretch.transform(minY: proxy.frame(in: .scrollView).minY, height: height)
                return view
                    .scaleEffect(transform.scale, anchor: .bottom)
                    .offset(y: transform.offsetY)
                    .opacity(transform.opacity)
            }
        }
    }
}
