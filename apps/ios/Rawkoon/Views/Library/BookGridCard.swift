import RawkoonKit
import SwiftUI

/// Regular-width counterpart of `BookRow`: a cover-first card for the books grid.
struct BookGridCard: View {
    let book: BookListItem
    let downloaded: Bool
    /// Audiobook listening fraction (0...1) for an in-progress book, else nil.
    var progress: Double?
    var menuItems: [BookCardMenuAction] = []
    var onMenuAction: (BookCardMenuAction) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            cover
            Text(book.title)
                .font(.display(14))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2, reservesSpace: true)
                .multilineTextAlignment(.leading)
            Text(book.author ?? "")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
            HStack(spacing: 6) {
                if book.hasAudiobook {
                    formatChip("Audiobook")
                }
                if book.hasEbook {
                    formatChip("Ebook")
                }
                if book.isRead {
                    StatusBadge(verbatim: bookReadStatusText(), tint: Theme.seed)
                }
                if downloaded {
                    StatusBadge(text: "Offline", tint: Theme.seed)
                }
            }
            if let progress, progress > 0.001, progress < 0.999 {
                HStack(spacing: 8) {
                    DuskProgress(value: progress)
                    Text(verbatim: "\(Int(progress * 100))%")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.apricot)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .bookCardContextMenu(items: menuItems, onAction: onMenuAction)
    }

    private var cover: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                CachedAsyncImage(url: book.coverURL, targetSize: CGSize(width: 440, height: 440)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    LinearGradient(
                        colors: [Theme.terracottaDeep, Theme.apricot],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                }
            }
            .overlay(alignment: .leading) {
                Rectangle().fill(.black.opacity(0.28)).frame(width: 8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.06), lineWidth: 1))
            .rawkoonZoomSource(RawkoonZoom.book(book.bookId))
    }

    private func formatChip(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(Theme.muted)
            .chipCapsule(tint: Theme.muted)
    }
}
