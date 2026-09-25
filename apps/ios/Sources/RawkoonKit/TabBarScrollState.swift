/// Decides when the custom tab bar collapses: after a sustained scroll down,
/// back on a sustained scroll up or at the top. Distances are measured from the
/// point where the direction last changed, so bounce jitter never flips it.
public struct TabBarScrollState: Equatable, Sendable {
    public private(set) var isCollapsed = false
    private var lastOffset: Double = 0
    private var anchor: Double
    private var movingDown = true
    private let threshold: Double
    private let topSlop: Double

    public init(threshold: Double = 24, topSlop: Double = 8) {
        self.threshold = threshold
        self.topSlop = topSlop
        anchor = topSlop
    }

    public mutating func update(offset: Double) {
        defer { lastOffset = offset }
        // At rest the next move can only be down, measured from the top zone's edge.
        guard offset > topSlop else {
            isCollapsed = false
            anchor = topSlop
            movingDown = true
            return
        }
        guard offset != lastOffset else { return }
        let down = offset > lastOffset
        if down != movingDown {
            anchor = lastOffset
            movingDown = down
        }
        if down, offset - anchor > threshold {
            isCollapsed = true
        }
        if !down, anchor - offset > threshold {
            isCollapsed = false
        }
    }

    public mutating func expand() {
        isCollapsed = false
        anchor = lastOffset
    }
}
