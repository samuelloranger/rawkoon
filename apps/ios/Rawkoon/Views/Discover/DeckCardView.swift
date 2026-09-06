import SwiftUI

/// A 2:3 poster card for the discover triage deck: cover fills the frame, a
/// bottom gradient scrim carries the title (Fraunces) and a mono metadata
/// line, and a small deck-level label pill ("For you" / "Trending now") sits
/// top-left. One accessibility element — the action bar has its own labels.
struct DeckCardView: View {
    let item: DiscoverDeckItem
    let label: String
    let posterURL: URL?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: posterURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                LinearGradient(
                    colors: [Theme.terracottaDeep, Theme.apricot],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()

            LinearGradient(
                colors: [.clear, .black.opacity(0.78)],
                startPoint: .center, endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.display(22))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                Text(metaLine)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.muted)
            }
            .padding(16)
        }
        .aspectRatio(2.0 / 3.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .background(Theme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.white.opacity(0.06), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 18, y: 12)
        .overlay(alignment: .topLeading) {
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .fontWeight(.medium)
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(.black.opacity(0.45), in: Capsule())
                .padding(12)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(item.title), \(metaLine)"))
    }

    private var metaLine: String {
        var parts: [String] = []
        if let year = item.releaseYear {
            parts.append(String(year))
        }
        if let rating = item.voteAverage, rating > 0 {
            parts.append("★" + String(format: "%.1f", rating))
        }
        parts.append(item.mediaType == "tv" ? "TV" : "Movie")
        return parts.joined(separator: " · ")
    }
}
