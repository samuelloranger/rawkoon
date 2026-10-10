import SwiftUI

/// Cinematic book header, matching `DetailHero`. Books ship no backdrop art, so
/// the cover itself — blurred and dimmed — becomes the ground behind a sharp
/// portrait cover. Mark-as-read lives in the navigation toolbar. Laid out
/// full-width by its container (the scroll VStack has no horizontal padding), so
/// the backdrop reaches the screen edges without any negative-padding trick.
struct BookHero<Badges: View>: View {
    let title: String
    let subtitle: String?
    let author: String
    let coverURL: URL?
    let metaLine: String?
    @ViewBuilder let badges: Badges

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // Blurred cover as the ground, overlaid on a fixed-size Rectangle so
            // layout is driven by the Rectangle, never by the image. Loading the
            // cover can't resize the hero — no flash.
            Rectangle()
                .fill(Theme.raised)
                .frame(maxWidth: .infinity)
                .frame(height: 260)
                .overlay {
                    CachedAsyncImage(url: coverURL, targetSize: CGSize(width: 400, height: 400)) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.clear
                    }
                    .blur(radius: 26)
                }
                .clipped()

            LinearGradient(
                colors: [Theme.base.opacity(0.15), Theme.base.opacity(0.6), Theme.base],
                startPoint: .top, endPoint: .bottom
            )
            .frame(maxWidth: .infinity)
            .frame(height: 260)

            HStack(alignment: .bottom, spacing: 16) {
                posterThumb
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.display(24))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(3)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(2)
                    }
                    if !author.isEmpty {
                        Text(author)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    if let metaLine, !metaLine.isEmpty {
                        Text(metaLine)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.faint)
                            .lineLimit(1)
                    }
                    HStack(spacing: 6) { badges }
                        .padding(.top, 2)
                }
                .padding(.bottom, 2)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 260)
    }

    /// Portrait cover with the rawkoon book-spine edge, so it reads as a book
    /// even against its own blurred art.
    private var posterThumb: some View {
        ZStack(alignment: .leading) {
            CachedAsyncImage(url: coverURL, targetSize: CGSize(width: 200, height: 300)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                LinearGradient(
                    colors: [Theme.terracottaDeep, Theme.apricot],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            }
            .frame(width: 100, height: 150)
            .clipped()

            Rectangle()
                .fill(.black.opacity(0.28))
                .frame(width: 5)
        }
        .frame(width: 100, height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.08), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
    }
}
