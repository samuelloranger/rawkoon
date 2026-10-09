import SwiftUI

/// A light band sweeping along an active progress fill. Mount it only while the work is running.
struct ProgressSheen: View {
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            LinearGradient(
                colors: [.clear, .white.opacity(0.35), .clear],
                startPoint: .leading, endPoint: .trailing
            )
            .frame(width: max(24, geo.size.width * 0.4))
            .offset(x: phase * geo.size.width)
        }
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1.2 }
        }
    }
}
