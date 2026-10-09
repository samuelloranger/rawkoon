import SwiftUI

/// Remembers which list items already played their entrance, so a lazy stack
/// re-creating a cell on scroll-back never replays it, and numbers each new
/// item's place in the current burst of appearances for the stagger.
final class EntranceLedger {
    /// A burst spans this long from its first appearance, so a fling can't climb the stagger forever.
    static let burstWindow: TimeInterval = 0.2

    private var entered: Set<AnyHashable> = []
    private var burstStart: TimeInterval = -.infinity
    private var burstPosition = 0

    /// The item's position in the current burst the first time `id` appears; nil after that.
    func claim(_ id: AnyHashable, now: TimeInterval) -> Int? {
        guard entered.insert(id).inserted else { return nil }
        if now - burstStart > Self.burstWindow {
            burstStart = now
            burstPosition = 0
        } else {
            burstPosition += 1
        }
        return burstPosition
    }

    func isPending(_ id: AnyHashable) -> Bool {
        !entered.contains(id)
    }
}

extension EnvironmentValues {
    @Entry var rawkoonEntranceLedger: EntranceLedger?
}

extension View {
    /// Owns the entrance ledger for one list or grid; put it on the container.
    func rawkoonEntranceScope() -> some View {
        modifier(EntranceScope())
    }

    /// Fades and rises this item in the first time it appears, staggered within its burst.
    func rawkoonEntrance(id: some Hashable) -> some View {
        modifier(Entrance(id: AnyHashable(id)))
    }
}

private struct EntranceScope: ViewModifier {
    @State private var ledger = EntranceLedger()

    func body(content: Content) -> some View {
        content.environment(\.rawkoonEntranceLedger, ledger)
    }
}

private struct Entrance: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.rawkoonEntranceLedger) private var ledger
    let id: AnyHashable
    @State private var entered = false

    /// Hidden only before the first claim; a claimed id always renders, even mid-animation.
    private var hidden: Bool {
        !entered && (ledger?.isPending(id) ?? true)
    }

    func body(content: Content) -> some View {
        content
            .opacity(hidden ? 0 : 1)
            .offset(y: hidden && !reduceMotion ? 12 : 0)
            .onAppear {
                guard !entered else { return }
                let position = ledger.map { $0.claim(id, now: ProcessInfo.processInfo.systemUptime) } ?? 0
                guard let position else {
                    entered = true
                    return
                }
                let animation = reduceMotion
                    ? RawkoonMotion.reduced
                    : RawkoonMotion.spring.delay(RawkoonMotion.staggerDelay(position: position))
                withAnimation(animation) { entered = true }
            }
    }
}
