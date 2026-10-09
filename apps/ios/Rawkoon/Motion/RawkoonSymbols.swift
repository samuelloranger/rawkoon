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
