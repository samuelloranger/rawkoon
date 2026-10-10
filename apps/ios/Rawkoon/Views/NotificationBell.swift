import SwiftUI

/// Home's toolbar bell. The unread dot fades in, and each new arrival bounces the bell and pulses the dot.
struct NotificationBell: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let unread: Int
    /// Arrivals seen with Reduce Motion off; drives the bounce and the pulse.
    @State private var arrivals = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: "bell")
                .symbolEffect(.bounce, value: arrivals)
            // Always mounted, so the first arrival (0 → 1) can pulse too.
            Circle()
                .fill(Theme.terracotta)
                .frame(width: 8, height: 8)
                .opacity(unread > 0 ? 1 : 0)
                .rawkoonCelebrate(trigger: arrivals, tint: Theme.terracotta, haptic: nil)
                .offset(x: 3, y: -3)
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: unread > 0)
        .onChange(of: unread) { old, new in
            guard Self.announcesArrival(from: old, to: new), !reduceMotion else { return }
            arrivals += 1
        }
    }

    /// Only a rising count is a new notification; reading them lowers it quietly.
    nonisolated static func announcesArrival(from old: Int, to new: Int) -> Bool {
        new > old
    }
}
