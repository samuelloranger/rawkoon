import RawkoonKit
import SwiftUI

/// A shelf's cover: its 2×2 poster mosaic (or the backdrop it chose) with the
/// name and how many titles it holds over the bottom of the art. The same
/// drawing the web and the TV use, so a shelf reads the same everywhere.
struct ShelfCoverView: View {
    @Environment(AppModel.self) private var model
    let shelf: ShelfSummary

    private var posters: [String] {
        if case let .mosaic(posters) = shelf.cover {
            return Array(posters.prefix(4))
        }
        return []
    }

    /// A single image cover: a title's backdrop, or the image uploaded on the web.
    private var backdrop: String? {
        switch shelf.cover {
        case let .backdrop(url): url
        case let .upload(url): url
        default: nil
        }
    }

    var body: some View {
        // A colour has no size of its own, so the 16:9 box comes from the card's
        // width and the art fills it; an image would otherwise impose its own shape.
        Color.clear
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .overlay { art }
            .overlay {
                // Darker over the lower third, so a name reads over any poster
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0.35),
                        .init(color: .black.opacity(0.55), location: 0.7),
                        .init(color: .black.opacity(0.92), location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: shelf.name)
                        .font(.display(17))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text("\(shelf.entryCount) titles")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.8))
                }
                .padding(10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(alignment: .topLeading) {
                if !shelf.visibleNow {
                    badge(String(localized: "Hidden now"))
                }
            }
            .overlay(alignment: .topTrailing) {
                if shelf.homeRow {
                    badge(String(localized: "On Home"))
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(0.06), lineWidth: 1))
            .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var art: some View {
        if let backdrop, let url = model.absoluteURL(backdrop) {
            image(url, width: 640, height: 360)
        } else {
            // Always 2×2 so a short shelf keeps the card's shape; empty cells show the inset colour
            VStack(spacing: 0) {
                ForEach(0 ..< 2, id: \.self) { row in
                    HStack(spacing: 0) {
                        ForEach(0 ..< 2, id: \.self) { column in
                            let index = row * 2 + column
                            if index < posters.count {
                                image(model.absoluteURL(posters[index]), width: 320, height: 180)
                            } else {
                                Theme.inset
                            }
                        }
                    }
                }
            }
        }
    }

    private func image(_ url: URL?, width: CGFloat, height: CGFloat) -> some View {
        CachedAsyncImage(url: url, targetSize: CGSize(width: width, height: height)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Theme.inset
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func badge(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(Theme.text)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(.black.opacity(0.7), in: Capsule())
            .padding(6)
    }
}
