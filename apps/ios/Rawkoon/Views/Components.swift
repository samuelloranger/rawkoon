import RawkoonKit
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
    private let text: Text
    var tint: Color = Theme.apricot

    init(text: LocalizedStringKey, tint: Color = Theme.apricot) {
        self.text = Text(text)
        self.tint = tint
    }

    /// Runtime / server tokens. A `String`/`StringProtocol` `text:` init would
    /// steal string literals from the `LocalizedStringKey` overload, so catalog
    /// keys like `In library` would render verbatim.
    init(verbatim: String, tint: Color = Theme.apricot) {
        self.text = Text(verbatim: verbatim)
        self.tint = tint
    }

    var body: some View {
        text
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
    var menuItems: [MediaPosterMenuAction] = []
    var onMenuAction: (MediaPosterMenuAction) -> Void = { _ in }
    @ViewBuilder var overlay: Overlay

    init(
        title: String,
        posterURL: URL?,
        menuItems: [MediaPosterMenuAction] = [],
        onMenuAction: @escaping (MediaPosterMenuAction) -> Void = { _ in },
        @ViewBuilder overlay: () -> Overlay = { EmptyView() }
    ) {
        self.title = title
        self.posterURL = posterURL
        self.menuItems = menuItems
        self.onMenuAction = onMenuAction
        self.overlay = overlay()
    }

    @ViewBuilder
    var body: some View {
        if menuItems.isEmpty {
            posterStack
        } else {
            posterStack.contextMenu {
                ForEach(menuItems, id: \.self) { action in
                    mediaPosterMenuButton(action, perform: onMenuAction)
                }
            }
        }
    }

    private var posterStack: some View {
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
                .font(.caption)
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
                .foregroundStyle(inLibrary ? Color(hex: 0x10231A) : Theme.onAccent)
        }
    }
}

/// Shared by LibraryView and BookView. A second copy would drift; `.searchable`
/// would change a screen that currently works.
func searchField(_ placeholder: LocalizedStringKey, text: Binding<String>) -> some View {
    searchFieldStack(text: text) {
        TextField(placeholder, text: text)
    }
}

func searchField(_ placeholder: some StringProtocol, text: Binding<String>) -> some View {
    searchFieldStack(text: text) {
        TextField(placeholder, text: text)
    }
}

private func searchFieldStack(
    text: Binding<String>,
    @ViewBuilder field: () -> some View
) -> some View {
    HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
            .font(.caption)
            .foregroundStyle(Theme.muted)
        field()
            .foregroundStyle(Theme.textStrong)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
        if !text.wrappedValue.isEmpty {
            Button {
                text.wrappedValue = ""
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(Theme.faint)
            }
            .buttonStyle(.plain)
        }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
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

/// A merged book row: cover, title/author, and format chips (Audiobook / EPUB).
struct BookRow: View {
    let book: BookListItem
    let downloaded: Bool
    var menuItems: [BookCardMenuAction] = []
    var onMenuAction: (BookCardMenuAction) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 12) {
            BookCover(url: book.coverURL, size: 56, corner: 10)

            VStack(alignment: .leading, spacing: 5) {
                Text(book.title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                if let author = book.author, !author.isEmpty {
                    Text(author).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(1)
                }
                HStack(spacing: 6) {
                    if book.hasAudiobook {
                        formatChip("Audiobook", tint: Theme.muted)
                    }
                    if book.hasEbook {
                        formatChip("Ebook", tint: Theme.muted)
                    }
                }
            }

            Spacer(minLength: 8)
            if downloaded {
                StatusBadge(text: "Offline", tint: Theme.seed)
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .bookCardContextMenu(items: menuItems, onAction: onMenuAction)
    }

    private func formatChip(_ text: LocalizedStringKey, tint: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }
}

struct ReleaseSearchPresentation: Identifiable {
    let query: String
    let libraryMediaId: Int?
    let tmdbId: Int
    let mediaType: String

    var id: String {
        "\(mediaType)-\(tmdbId)-\(libraryMediaId ?? 0)"
    }
}

extension View {
    @ViewBuilder
    func bookCardContextMenu(
        items: [BookCardMenuAction],
        onAction: @escaping (BookCardMenuAction) -> Void
    ) -> some View {
        if items.isEmpty {
            self
        } else {
            contextMenu {
                ForEach(items, id: \.self) { action in
                    bookCardMenuButton(action, perform: onAction)
                }
            }
        }
    }

    /// Same keep-files / delete-files choice MediaDetailView's remove flow uses.
    func libraryRemoveConfirmation(
        isPresented: Binding<Bool>,
        title: String,
        onConfirm: @escaping (_ deleteFiles: Bool) -> Void
    ) -> some View {
        confirmationDialog(
            "Remove from library?",
            isPresented: isPresented,
            titleVisibility: .visible
        ) {
            Button("Remove, keep files") { onConfirm(false) }
            Button("Remove and delete files", role: .destructive) { onConfirm(true) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("“\(title)” will leave your library. Deleting files also removes them from disk.")
        }
    }
}

@ViewBuilder
private func mediaPosterMenuButton(
    _ action: MediaPosterMenuAction,
    perform: @escaping (MediaPosterMenuAction) -> Void
) -> some View {
    switch action {
    case .toggleMonitored:
        Button { perform(action) } label: {
            Label("Toggle monitored", systemImage: "antenna.radiowaves.left.and.right")
        }
    case .searchReleases:
        Button { perform(action) } label: {
            Label("Search releases", systemImage: "magnifyingglass")
        }
    case .openDetails:
        Button { perform(action) } label: {
            Label("Open details", systemImage: "info.circle")
        }
    case .removeFromLibrary:
        Button(role: .destructive) { perform(action) } label: {
            Label("Remove from library", systemImage: "trash")
        }
    }
}

@ViewBuilder
private func bookCardMenuButton(
    _ action: BookCardMenuAction,
    perform: @escaping (BookCardMenuAction) -> Void
) -> some View {
    switch action {
    case .read:
        Button { perform(action) } label: {
            Label("Read", systemImage: "book.pages")
        }
    case .play:
        Button { perform(action) } label: {
            Label("Play", systemImage: "play.fill")
        }
    case .addAudiobook:
        Button { perform(action) } label: {
            Label("Add audiobook", systemImage: "plus.circle")
        }
    case .addEbook:
        Button { perform(action) } label: {
            Label("Add ebook", systemImage: "plus.circle")
        }
    case .rescan:
        Button { perform(action) } label: {
            Label("Rescan", systemImage: "arrow.clockwise")
        }
    }
}
