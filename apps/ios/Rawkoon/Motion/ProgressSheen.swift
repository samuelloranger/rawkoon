import SwiftUI

/// A light band sweeping along an active progress fill. Mount it only while the work is running.
struct ProgressSheen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion {
            Color.clear
        } else {
            // Time-derived position, so a resizing fill never retargets a running animation.
            TimelineView(.animation) { context in
                let cycle = 1.4
                let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle
                GeometryReader { geo in
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.35), .clear],
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: max(24, geo.size.width * 0.4))
                    .offset(x: (t * 2.2 - 1) * geo.size.width)
                }
                .allowsHitTesting(false)
            }
        }
    }
}
