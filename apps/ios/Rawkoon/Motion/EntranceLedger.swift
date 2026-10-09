import SwiftUI

/// Remembers which list items already played their entrance, so a lazy stack
/// re-creating a cell on scroll-back never replays it, and numbers each new
/// item's place in the current burst of appearances for the stagger.
final class EntranceLedger {
    /// Appearances closer together than this belong to one burst.
    static let burstGap: TimeInterval = 0.12

    private var entered: Set<AnyHashable> = []
    private var burstPosition = 0
    private var lastClaim: TimeInterval = -.infinity

    /// The item's position in the current burst the first time `id` appears; nil after that.
    func claim(_ id: AnyHashable, now: TimeInterval) -> Int? {
        guard entered.insert(id).inserted else { return nil }
        burstPosition = now - lastClaim > Self.burstGap ? 0 : burstPosition + 1
        lastClaim = now
        return burstPosition
    }

    func isPending(_ id: AnyHashable) -> Bool {
        !entered.contains(id)
    }
}
