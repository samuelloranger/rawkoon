import SwiftUI

/// Cinematic detail header: a 260pt backdrop wash, the poster, a Fraunces title,
/// a status pill, a mono meta line, and the tagline. The watchlist action lives
/// in the navigation toolbar so the artwork and identity stay the only focus
/// here. The hero is laid out full-width by its container (the scroll VStack has
/// no horizontal padding), so the backdrop reaches the screen edges without any
/// negative-padding trick — inner content keeps the 16pt gutter.
struct DetailHero: View {
    @Environment(AppModel.self) private var model

    let title: String
    let posterPath: String?
    let backdropPath: String?
    let metaLine: String
    let tagline: String?
    let statusText: String
    let statusTint: Color
    /// True once the title is in the library or requested; turning true pops the pill.
    var statusEarned = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            backdrop
                .rawkoonStretchyHero(height: 260)

            HStack(alignment: .bottom, spacing: 16) {
                posterThumb
                VStack(alignment: .leading, spacing: 7) {
                    Text(title)
                        .font(.display(26))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(3)
                    statusPill
                    Text(metaLine)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                    if let tagline, !tagline.isEmpty {
                        Text(tagline)
                            .font(.caption.italic())
                            .foregroundStyle(Theme.text)
                            .lineLimit(2)
                    }
                }
                .padding(.bottom, 2)
                .rawkoonLanding(step: 0)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 260)
    }

    /// The backdrop and its fade to the page, moved as one layer by the stretch and parallax.
    private var backdrop: some View {
        ZStack {
            // The image is an overlay on a fixed-size Rectangle (the same pattern
            // the poster uses), so layout is driven by the Rectangle, never by
            // the image. Loading the backdrop can't resize the hero — no flash.
            Rectangle()
                .fill(Theme.raised)
                .frame(maxWidth: .infinity)
                .frame(height: 260)
                .overlay {
                    CachedAsyncImage(url: model.absoluteURL(backdropPath), targetSize: CGSize(width: 600, height: 320)) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.clear
                    }
                }
                .clipped()

            LinearGradient(
                colors: [.clear, Theme.base.opacity(0.55), Theme.base],
                startPoint: .top, endPoint: .bottom
            )
            .frame(maxWidth: .infinity)
            .frame(height: 260)
        }
    }

    /// One slot keyed by the text, so a status change crossfades instead of cutting.
    private var statusPill: some View {
        ZStack(alignment: .leading) {
            StatusBadge(verbatim: statusText, tint: statusTint)
                .id(statusText)
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: statusText)
        // Visual only: the request and add flows already play their own haptic.
        .rawkoonCelebrate(trigger: statusEarned, ring: .roundedRect(cornerRadius: 12), haptic: nil, when: { !$0 && $1 })
    }

    private var posterThumb: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Theme.raised)
            .frame(width: 96, height: 144)
            .overlay(
                CachedAsyncImage(url: model.absoluteURL(posterPath), targetSize: CGSize(width: 192, height: 288)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    LinearGradient(
                        colors: [Theme.terracottaDeep, Theme.apricot],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                }
                .frame(width: 96, height: 144)
                .clipped()
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
    }
}
