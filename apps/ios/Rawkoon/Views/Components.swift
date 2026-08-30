import SwiftUI

/// Cover art with the rawkoon "book spine" edge — a dark strip down the left,
/// so even a plain gradient placeholder reads as a book on a shelf.
struct BookCover: View {
    let url: URL?
    var size: CGFloat
    var corner: CGFloat = 10

    var body: some View {
        ZStack(alignment: .leading) {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                LinearGradient(
                    colors: [Theme.terracottaDeep, Theme.apricot],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            }
            .frame(width: size, height: size)
            .clipped()

            Rectangle()
                .fill(.black.opacity(0.28))
                .frame(width: max(3, size * 0.05))
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner))
        .overlay(
            RoundedRectangle(cornerRadius: corner).strokeBorder(.white.opacity(0.06), lineWidth: 1)
        )
    }
}

/// A monospaced state pill. Semantic tint (green present, apricot active, …)
/// carries meaning at a glance so a list is scannable without reading it.
struct StatusBadge: View {
    let text: String
    var tint: Color = Theme.apricot

    var body: some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .fontWeight(.medium)
            .foregroundStyle(tint)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }
}

/// The Cozy Dusk progress bar: a well groove with a terracotta→apricot fill.
struct DuskProgress: View {
    /// 0...1
    let value: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.well)
                Capsule()
                    .fill(Theme.progress)
                    .frame(width: max(0, min(1, value)) * geo.size.width)
            }
        }
        .frame(height: 5)
    }
}
