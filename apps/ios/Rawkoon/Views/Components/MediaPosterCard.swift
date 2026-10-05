import SwiftUI

/// A 2:3 poster with an in-library chip, plus a flexible-height caption below
/// — unlike `DiscoverView`'s rail card, this never clips at large Dynamic
/// Type: the caption sizes to its content instead of a fixed 34pt frame,
/// with `minimumScaleFactor` as the last-resort guard rail.
struct MediaPosterCard: View {
    @Environment(AppModel.self) private var model
    let item: TmdbSearchItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedAsyncImage(url: model.absoluteURL(item.posterUrl), targetSize: CGSize(width: 160, height: 240)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.raised
            }
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topTrailing) {
                if item.alreadyExists == true {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color(hex: 0x10231A))
                        .frame(width: 22, height: 22)
                        .background(Theme.seed, in: Circle())
                        .accessibilityLabel("In library")
                        .padding(6)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.06), lineWidth: 1)
            )

            Text(item.title)
                .font(.caption)
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
