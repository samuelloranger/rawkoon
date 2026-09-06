import SwiftUI

/// Cozy Dusk hero for a title: backdrop wash, poster, Fraunces title, a mono
/// meta line, and the watchlist bookmark. No apricot fill lives here — the one
/// lamp is the primary action below the hero.
struct DetailHero: View {
    @Environment(AppModel.self) private var model

    let title: String
    let posterPath: String?
    let backdropPath: String?
    let metaLine: String
    let tagline: String?
    let inWatchlist: Bool
    let watchlistPending: Bool
    let onToggleWatchlist: () -> Void

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: model.absoluteURL(backdropPath)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.raised
            }
            .frame(height: 200)
            .clipped()

            LinearGradient(
                colors: [.clear, Theme.base],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: 200)

            HStack(alignment: .bottom, spacing: 14) {
                posterThumb
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.display(22))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(3)
                    Text(metaLine)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                    if let tagline, !tagline.isEmpty {
                        Text(tagline)
                            .font(.caption.italic())
                            .foregroundStyle(Theme.muted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                Button(action: onToggleWatchlist) {
                    Image(systemName: inWatchlist ? "bookmark.fill" : "bookmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(inWatchlist ? Theme.terracotta : Theme.textStrong)
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                        .background(Theme.base.opacity(0.55), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(LocalizedStringKey(inWatchlist ? "Remove from watchlist" : "Add to watchlist")))
                .disabled(watchlistPending)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
        .frame(height: 200)
    }

    private var posterThumb: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Theme.raised)
            .frame(width: 84, height: 126)
            .overlay(
                AsyncImage(url: model.absoluteURL(posterPath)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    LinearGradient(
                        colors: [Theme.terracottaDeep, Theme.apricot],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                }
                .frame(width: 84, height: 126)
                .clipped()
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
    }
}
