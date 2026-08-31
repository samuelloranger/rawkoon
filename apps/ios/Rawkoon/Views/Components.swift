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

/// A normalized media poster card for grids: a fixed 2:3 poster with a
/// top-trailing overlay (flag/badge) and a 2-line title caption below. The
/// reserved title height keeps every card the same height regardless of how
/// long the title is.
struct MediaPosterCard<Overlay: View>: View {
    let title: String
    let posterURL: URL?
    @ViewBuilder var overlay: Overlay

    init(title: String, posterURL: URL?, @ViewBuilder overlay: () -> Overlay = { EmptyView() }) {
        self.title = title
        self.posterURL = posterURL
        self.overlay = overlay()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Rectangle()
                .fill(Theme.raised)
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .overlay {
                    AsyncImage(url: posterURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "photo")
                            .font(.title3)
                            .foregroundStyle(Theme.faint)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topTrailing) { overlay.padding(6) }
                .overlay(
                    RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.05), lineWidth: 1)
                )

            Text(title)
                .font(.display(13))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(height: 34, alignment: .top)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The in-library / add flag used on discover posters.
struct PosterFlag: View {
    let inLibrary: Bool
    var body: some View {
        ZStack {
            Circle().fill(inLibrary ? Theme.seed : Theme.apricot)
                .frame(width: 22, height: 22)
            Image(systemName: inLibrary ? "checkmark" : "plus")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(inLibrary ? Color(hex: 0x10231a) : Theme.onAccent)
        }
    }
}

/// One chapter as a "spine": a lit bar for the current chapter, filled for a
/// downloaded one, hollow for not-yet. Order is the sequence — honest structure.
struct SpineRow: View {
    let index: Int
    let title: String
    let downloaded: Bool
    let current: Bool

    var body: some View {
        HStack(spacing: 10) {
            spine
            Text(String(format: "%02d", index + 1))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .frame(width: 22, alignment: .leading)
            Text(title)
                .font(.subheadline)
                .fontWeight(current ? .semibold : .regular)
                .foregroundStyle(current ? Theme.textStrong : Theme.muted)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }

    private var spine: some View {
        Group {
            if current {
                Capsule().fill(Theme.progress).frame(width: 4, height: 30)
                    .shadow(color: Theme.apricot.opacity(0.55), radius: 6)
            } else {
                Capsule().fill(downloaded ? Theme.faint : Theme.borderStrong)
                    .frame(width: 4, height: 22)
            }
        }
    }
}
