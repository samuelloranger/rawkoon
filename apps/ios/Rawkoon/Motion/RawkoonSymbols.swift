import SwiftUI

enum LivingSymbolKind {
    case empty, error
}

extension View {
    /// Rolls the digits of the number this text shows when `value` changes.
    func rawkoonNumeric(_ value: Double) -> some View {
        modifier(NumericRoll(value: value))
    }

    /// One bounce for an empty state, one wiggle for an error, played once on appear.
    func rawkoonLivingSymbol(_ kind: LivingSymbolKind) -> some View {
        modifier(LivingSymbol(kind: kind))
    }

    /// One bounce each time `trigger` changes; still under Reduce Motion.
    func rawkoonSymbolBounce(_ trigger: some Equatable) -> some View {
        modifier(SymbolBounce(trigger: trigger))
    }

    /// One spin of the symbol's arrow each time `trigger` changes; still under Reduce Motion.
    func rawkoonSymbolSpin(_ trigger: some Equatable, clockwise: Bool) -> some View {
        modifier(SymbolSpin(trigger: trigger, clockwise: clockwise))
    }

    /// One bounce when this symbol is inserted while `armed`; for a glyph that replaces another on a state change.
    func rawkoonBounceOnInsert(armed: Bool) -> some View {
        modifier(BounceOnInsert(armed: armed))
    }
}

private struct SymbolSpin<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger
    let clockwise: Bool

    func body(content: Content) -> some View {
        // A value that never changes under Reduce Motion, so the effect never fires.
        let value = reduceMotion ? nil : Optional(trigger)
        return Group {
            if clockwise {
                content.symbolEffect(.rotate.clockwise.byLayer, value: value)
            } else {
                content.symbolEffect(.rotate.counterClockwise.byLayer, value: value)
            }
        }
    }
}

private struct BounceOnInsert: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let armed: Bool
    @State private var bounces = 0

    func body(content: Content) -> some View {
        content
            .symbolEffect(.bounce, value: bounces)
            // A task, not onAppear, so the effect sees the change once the symbol is on screen.
            .task {
                guard armed, !reduceMotion else { return }
                bounces += 1
            }
    }
}

private struct SymbolBounce<Trigger: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Trigger

    func body(content: Content) -> some View {
        // A value that never changes under Reduce Motion, so the effect never fires.
        content.symbolEffect(.bounce, value: reduceMotion ? nil : Optional(trigger))
    }
}

private struct NumericRoll: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let value: Double

    func body(content: Content) -> some View {
        content
            .contentTransition(reduceMotion ? .opacity : .numericText(value: value))
            .animation(reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.snappy, value: value)
    }
}

private struct LivingSymbol: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let kind: LivingSymbolKind
    @State private var tick = 0

    func body(content: Content) -> some View {
        Group {
            switch kind {
            case .empty: content.symbolEffect(.bounce, value: tick)
            case .error: content.symbolEffect(.wiggle, value: tick)
            }
        }
        .task {
            guard !reduceMotion else { return }
            // Let the screen's own appearance settle before the symbol moves.
            try? await Task.sleep(for: .milliseconds(250))
            tick += 1
        }
    }
}
