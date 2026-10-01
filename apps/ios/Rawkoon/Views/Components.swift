import RawkoonKit
import SwiftUI

/// Cover art with the rawkoon "book spine" edge — a dark strip down the left,
/// so even a plain gradient placeholder reads as a book on a shelf.
struct BookCover: View {
    let url: URL?
    var size: CGFloat
    var corner: CGFloat = 10
    var zoomID: RawkoonZoom.ID?

    var body: some View {
        ZStack(alignment: .leading) {
            CachedAsyncImage(url: url, targetSize: CGSize(width: size, height: size)) { image in
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
        .rawkoonZoomSource(zoomID)
    }
}

/// A film/TV poster thumbnail — a plain 2:3 poster with no book-spine edge, for
/// rows and calendars where `BookCover` (which draws a spine) would wrongly
/// make a movie read as a book. Width-driven; height is the 2:3 counterpart.
struct MediaThumb: View {
    let url: URL?
    var width: CGFloat
    var corner: CGFloat = 8

    var body: some View {
        Rectangle()
            .fill(Theme.raised)
            .overlay {
                CachedAsyncImage(url: url, targetSize: CGSize(width: width * 2, height: width * 3)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "photo")
                        .font(.caption)
                        .foregroundStyle(Theme.faint)
                }
            }
            .frame(width: width, height: width * 3 / 2)
            .clipShape(RoundedRectangle(cornerRadius: corner))
            .overlay(
                RoundedRectangle(cornerRadius: corner).strokeBorder(.white.opacity(0.05), lineWidth: 1)
            )
    }
}

extension View {
    /// The state-pill chrome StatusBadge uses — tinted fill + hairline in a
    /// Capsule — as a modifier, for the few chips that carry custom content
    /// (a non-monospaced label, an icon) and can't be a plain `StatusBadge`.
    func chipCapsule(tint: Color) -> some View {
        padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
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
        text = Text(verbatim: verbatim)
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

/// The one media poster card, shared by Home rails, the library grid, and
/// Similar. A 2:3 poster with the title (and optional date / episode) in a
/// bottom glass panel — never captioned underneath — plus an optional
/// top-trailing overlay (flag/badge) and an optional context menu. Pass `width`
/// for a fixed-size rail card; leave it nil to fill a grid cell.
struct MediaPosterCard<Overlay: View>: View {
    let title: String
    let posterURL: URL?
    var date: String?
    var episode: String?
    var width: CGFloat?
    var corner: CGFloat = 16
    var menuItems: [MediaPosterMenuAction] = []
    var onMenuAction: (MediaPosterMenuAction) -> Void = { _ in }
    @ViewBuilder var overlay: Overlay

    init(
        title: String,
        posterURL: URL?,
        date: String? = nil,
        episode: String? = nil,
        width: CGFloat? = nil,
        corner: CGFloat = 16,
        menuItems: [MediaPosterMenuAction] = [],
        onMenuAction: @escaping (MediaPosterMenuAction) -> Void = { _ in },
        @ViewBuilder overlay: () -> Overlay = { EmptyView() }
    ) {
        self.title = title
        self.posterURL = posterURL
        self.date = date
        self.episode = episode
        self.width = width
        self.corner = corner
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
        let shape = RoundedRectangle(cornerRadius: corner, style: .continuous)
        return Rectangle()
            .fill(Theme.raised)
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .frame(width: width)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .overlay {
                CachedAsyncImage(url: posterURL, targetSize: CGSize(width: 160, height: 240)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "photo")
                        .font(.title3)
                        .foregroundStyle(Theme.faint)
                }
            }
            .overlay {
                LinearGradient(
                    colors: [.black.opacity(0.55), .black.opacity(0.08), .clear],
                    startPoint: .bottom,
                    endPoint: .center
                )
                .allowsHitTesting(false)
            }
            .overlay(alignment: .bottom) { caption }
            .overlay(alignment: .topTrailing) { overlay.padding(6) }
            .clipShape(shape)
            .overlay(shape.strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .contentShape(shape)
            .accessibilityElement(children: .combine)
            .accessibilityLabel([title, date, episode].compactMap(\.self).joined(separator: ", "))
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if date != nil || episode != nil {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let date {
                        Text(date)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                    Spacer(minLength: 0)
                    if let episode {
                        Text(episode)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.apricot)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
                .overlay(Color.black.opacity(0.32))
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
                    // A 44pt hit area without growing the field.
                    .padding(12)
                    .contentShape(Rectangle())
                    .padding(-12)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Clear")
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
    /// Live 0...1 while this chapter is downloading, else nil.
    var downloadFraction: Double?
    /// Set on the one chapter holding a stored resume point; the row then opens
    /// there rather than at the chapter's start.
    var resumeText: String?

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
            if let resumeText {
                Text(resumeText)
                    .font(.caption2)
                    .foregroundStyle(Theme.apricot)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
        }
        .padding(.vertical, 2)
    }

    private var spine: some View {
        Group {
            if let fraction = downloadFraction, !downloaded {
                // Same 4x22 footprint as an idle pill, so rows never shift.
                let clamped = min(1, max(0, fraction))
                Capsule().fill(Theme.borderStrong)
                    .frame(width: 4, height: 22)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(Theme.progress)
                            .frame(height: 22 * clamped)
                    }
                    .clipShape(Capsule())
                    .shadow(color: Theme.apricot.opacity(0.25 + 0.45 * clamped), radius: 3 + 3 * clamped)
                    .animation(.linear(duration: 0.15), value: clamped)
            } else if current {
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
    /// Audiobook listening fraction (0...1) for an in-progress book, else nil.
    var progress: Double?
    var menuItems: [BookCardMenuAction] = []
    var onMenuAction: (BookCardMenuAction) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 12) {
            BookCover(url: book.coverURL, size: 56, corner: 10, zoomID: RawkoonZoom.book(book.bookId))

            VStack(alignment: .leading, spacing: 5) {
                Text(book.title)
                    .font(.display(14))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(1)
                    .truncationMode(.tail)
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
                    // Inline, not a trailing column, so the badge can't narrow the title.
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
                    .padding(.top, 2)
                }
            }

            Spacer(minLength: 0)
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
            .chipCapsule(tint: tint)
    }
}

/// A destructive book action waiting on the user's confirmation.
enum PendingBookConfirm: Identifiable {
    case markRead(BookListItem)
    case resetProgress(BookListItem)
    case removeDownload(BookListItem)

    var id: String {
        switch self {
        case let .markRead(book): "read-\(book.bookId)"
        case let .resetProgress(book): "reset-\(book.bookId)"
        case let .removeDownload(book): "remove-\(book.bookId)"
        }
    }

    var title: String {
        switch self {
        case .markRead: String(localized: "Mark as read?")
        case .resetProgress: String(localized: "Reset progress?")
        case .removeDownload: String(localized: "Remove downloaded audiobook?")
        }
    }

    var message: String {
        switch self {
        case .markRead: String(localized: "This resets ebook and audiobook progress.")
        case .resetProgress: String(localized: "Clears ebook and audiobook progress. The read badge stays.")
        case .removeDownload:
            String(localized: "Deletes the offline chapters from this iPhone. Playback will need the network until you download them again.")
        }
    }

    var confirmLabel: String {
        switch self {
        case .markRead: String(localized: "Mark as read")
        case .resetProgress: String(localized: "Reset progress")
        case .removeDownload: String(localized: "Remove Download")
        }
    }
}

/// The trailing "…" menu on the book detail screen; same actions as the card long-press.
struct BookActionsMenu: View {
    let items: [BookCardMenuAction]
    let onAction: (BookCardMenuAction) -> Void

    var body: some View {
        Menu {
            ForEach(items, id: \.self) { action in
                bookCardMenuButton(action, perform: onAction)
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel(Text("More"))
    }
}

extension AppModel {
    /// Goes through the root-level alert: one raised from a zoom-pushed screen stays hidden.
    func confirmBookAction(_ pending: PendingBookConfirm, onDone: @escaping () async -> Void = {}) {
        let destructive: Bool
        let run: @MainActor () -> Void
        switch pending {
        case let .markRead(book):
            destructive = false
            run = { [self] in
                Task {
                    await setBookRead(book, read: true)
                    await onDone()
                }
            }
        case let .resetProgress(book):
            destructive = false
            run = { [self] in
                Task {
                    await resetBookProgress(book)
                    await onDone()
                }
            }
        case let .removeDownload(book):
            destructive = true
            run = { [self] in
                if let editionId = book.audiobookEditionId {
                    removeDownload(editionId: editionId)
                }
                Task { await onDone() }
            }
        }
        pendingConfirm = ConfirmRequest(
            title: pending.title,
            message: pending.message,
            confirmTitle: pending.confirmLabel,
            isDestructive: destructive,
            action: run
        )
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
        rawkoonConfirm("Remove from library?", isPresented: isPresented) {
            Button("Remove, keep files") { onConfirm(false) }
            Button("Remove and delete files", role: .destructive) { onConfirm(true) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("“\(title)” will leave your library. Deleting files also removes them from disk.")
        }
    }

    /// Window-level confirm. iOS 26's `confirmationDialog` is a popover anchored
    /// to this view — on a ScrollView that lands off-screen or on the wrong row.
    func rawkoonConfirm(
        _ title: LocalizedStringKey,
        isPresented: Binding<Bool>,
        @ViewBuilder actions: () -> some View
    ) -> some View {
        alert(title, isPresented: isPresented, actions: actions)
    }

    func rawkoonConfirm(
        _ title: LocalizedStringKey,
        isPresented: Binding<Bool>,
        @ViewBuilder actions: () -> some View,
        @ViewBuilder message: () -> some View
    ) -> some View {
        alert(title, isPresented: isPresented, actions: actions, message: message)
    }

    func rawkoonConfirm<T>(
        _ title: LocalizedStringKey,
        isPresented: Binding<Bool>,
        presenting data: T?,
        @ViewBuilder actions: (T) -> some View,
        @ViewBuilder message: (T) -> some View
    ) -> some View {
        alert(title, isPresented: isPresented, presenting: data, actions: actions, message: message)
    }
}

/// Greyed rather than hidden offline, so the menu keeps its shape and says why.
private func mediaPosterMenuButton(
    _ action: MediaPosterMenuAction,
    perform: @escaping (MediaPosterMenuAction) -> Void
) -> some View {
    mediaPosterMenuButtonContent(action, perform: perform)
        .disabled(action.requiresConnection && AppModel.shared.isOffline)
}

@ViewBuilder
private func mediaPosterMenuButtonContent(
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

private func bookCardMenuButton(
    _ action: BookCardMenuAction,
    perform: @escaping (BookCardMenuAction) -> Void
) -> some View {
    bookCardMenuButtonContent(action, perform: perform)
        .disabled(action.requiresConnection && AppModel.shared.isOffline)
}

@ViewBuilder
private func bookCardMenuButtonContent(
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
    case .markRead:
        Button { perform(action) } label: {
            Label("Mark as read", systemImage: "checkmark.circle")
        }
    case .markUnread:
        Button { perform(action) } label: {
            Label("Mark as unread", systemImage: "checkmark.circle.badge.minus")
        }
    case .resetProgress:
        Button { perform(action) } label: {
            Label("Reset progress", systemImage: "arrow.counterclockwise")
        }
    case .download:
        Button { perform(action) } label: {
            Label("Download", systemImage: "arrow.down.circle")
        }
    case .removeDownload:
        Button(role: .destructive) { perform(action) } label: {
            Label("Remove download", systemImage: "trash")
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

// MARK: Audiobook action row

/// Play and its download companion share one height so the row reads as a pair.
enum BookActionMetrics {
    static let height: CGFloat = 54
}

struct BookPlayButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.onAccent)
            .frame(maxWidth: .infinity)
            .frame(height: BookActionMetrics.height)
            .background(Capsule().fill(Theme.apricot))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
    }
}

struct BookIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: BookActionMetrics.height, height: BookActionMetrics.height)
            .background(Circle().fill(Theme.raised))
            .overlay(Circle().strokeBorder(Theme.borderStrong, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .contentShape(Circle())
    }
}

enum AudiobookDownloadState: Equatable {
    case idle
    case preparing
    case downloading(fraction: Double, done: Int, total: Int)
    case failed(done: Int, total: Int)
    case downloaded

    enum Kind { case idle, preparing, downloading, failed, downloaded }

    var kind: Kind {
        switch self {
        case .idle: .idle
        case .preparing: .preparing
        case .downloading: .downloading
        case .failed: .failed
        case .downloaded: .downloaded
        }
    }

    var accessibilityLabel: LocalizedStringKey {
        switch self {
        case .idle: "Download"
        case .preparing: "Preparing download..."
        case .downloading: "Cancel"
        case .failed: "Retry"
        case .downloaded: "Remove Download"
        }
    }
}

/// The glyph inside the round download button for each state.
struct DownloadStateIcon: View {
    let state: AudiobookDownloadState
    /// Just finished: show a green check before settling on the struck-through arrow.
    var celebrating = false

    var body: some View {
        switch state {
        case .idle:
            Image(systemName: "arrow.down.to.line")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.apricot)
        case .preparing:
            ProgressView().tint(Theme.apricot)
        case let .downloading(fraction, _, _):
            ZStack {
                Circle().stroke(Theme.borderStrong, lineWidth: 3)
                Circle()
                    .trim(from: 0, to: max(0.02, min(1, fraction)))
                    .stroke(Theme.apricot, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.15), value: fraction)
                Image(systemName: "stop.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.apricot)
            }
            .padding(10)
        case .failed:
            Image(systemName: "arrow.clockwise")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.terracotta)
        case .downloaded where celebrating:
            Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(Theme.seed)
                .symbolEffect(.bounce, value: celebrating)
                .transition(.scale.combined(with: .opacity))
        case .downloaded:
            ZStack {
                Image(systemName: "arrow.down.to.line")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.muted)
                // A slash cut through the arrow: a background-coloured bar knocks out
                // the glyph behind it, then the visible bar sits on top.
                Capsule().fill(Theme.raised).frame(width: 6, height: 30)
                    .rotationEffect(.degrees(45))
                Capsule().fill(Theme.muted).frame(width: 2.5, height: 30)
                    .rotationEffect(.degrees(45))
            }
        }
    }
}
