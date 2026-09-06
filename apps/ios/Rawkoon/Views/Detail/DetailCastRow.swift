import SwiftUI

/// Horizontally scrolling cast row with circular headshots. Warm shimmer
/// placeholders while credits load; a quiet empty state when a title has none.
struct DetailCastRow: View {
    @Environment(AppModel.self) private var model

    let credits: MediaCredits?
    let loading: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Cast")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)
                if let directors = credits?.directors, !directors.isEmpty {
                    Spacer()
                    Text(directors.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 16)

            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading, credits == nil {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(0 ..< 6, id: \.self) { _ in
                        VStack(spacing: 6) {
                            ShimmerView(cornerRadius: 32)
                                .frame(width: 64, height: 64)
                            ShimmerView(cornerRadius: 4)
                                .frame(width: 60, height: 10)
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        } else if let cast = credits?.cast, !cast.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(cast) { member in
                        castCard(member)
                    }
                }
                .padding(.horizontal, 16)
            }
        } else {
            Text("No cast information.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
        }
    }

    private func castCard(_ member: CastMember) -> some View {
        VStack(spacing: 6) {
            AsyncImage(url: model.absoluteURL(member.profilePath)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                LinearGradient(
                    colors: [Theme.terracottaDeep, Theme.apricot],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            }
            .frame(width: 64, height: 64)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))

            Text(member.name)
                .font(.caption2.weight(.medium))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(1)
            if let character = member.character, !character.isEmpty {
                Text(character)
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
            }
        }
        .frame(width: 76)
    }
}
