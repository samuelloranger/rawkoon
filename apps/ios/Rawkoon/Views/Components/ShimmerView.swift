import SwiftUI

/// A warm skeleton placeholder — apricot shimmer over `Theme.well`, never a gray
/// spinner. Under Reduce Motion it renders as a static well fill.
struct ShimmerView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var cornerRadius: CGFloat = 8
    @State private var phase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(Theme.well)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, Theme.apricot.opacity(0.14), .clear],
                            startPoint: .leading, endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 1.6)
                        .offset(x: phase * geo.size.width * 1.6)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                }
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
            .accessibilityHidden(true)
    }
}

extension View {
    /// Overlays a `ShimmerView` on top of this view while `active`, hiding the
    /// content underneath — the warm-skeleton equivalent of `.redacted`.
    @ViewBuilder
    func redactedShimmer(_ active: Bool) -> some View {
        if active {
            ShimmerView()
                .accessibilityHidden(true)
        } else {
            self
        }
    }
}
