import Foundation
import RawkoonKit
import SwiftUI

enum BookDetailLane: String, CaseIterable, Identifiable {
    case audiobook = "Audiobook"
    case ebook = "Ebook"
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .audiobook: "Audiobook"
        case .ebook: "Ebook"
        }
    }
}

enum ReleaseSearchLane: String, Identifiable {
    case audiobook
    case ebook
    var id: String {
        rawValue
    }
}

struct BookView: View {
    @Environment(AppModel.self) var model
    @Environment(\.horizontalSizeClass) var hSizeClass

    var isRegularWidth: Bool {
        hSizeClass == .regular
    }

    let book: BookListItem

    @State var detail: BookDetailItem?
    @State var loadingDetail = false
    @State var detailError: String?
    @State var activeLane: BookDetailLane

    @State var manifest: BookManifest?
    @State var loadingManifest = false
    /// False until `fetchManifest` has actually run. The chapter list treats
    /// "not yet attempted" as loading, not as "Chapters couldn't load."
    @State var fetchAttemptedManifest = false
    @State var rescanningManifest = false
    @State var showingPlayer = false
    @State var chapterFilter = ""
    @State var releaseSearchLane: ReleaseSearchLane?
    @State var manifestError: String?
    @State var attemptedAutomaticRecovery = false

    @State var audiobookState = BookAudiobookState()
    @State var ebookState = BookEbookState()
    @State var previewDocument: EbookPreviewDocument?
    @State var addingEditionKind: String?

    init(book: BookListItem, preferEbook: Bool = false) {
        self.book = book
        if preferEbook, book.hasEbook {
            _activeLane = State(initialValue: .ebook)
        } else {
            _activeLane = State(initialValue: book.hasAudiobook ? .audiobook : .ebook)
        }
    }

    var audiobookEdition: BookEditionDetail? {
        detail?.editions.first(where: { $0.kind == "audiobook" })
    }

    var ebookEdition: BookEditionDetail? {
        detail?.editions.first(where: { $0.kind == "ebook" })
    }

    var audiobookEditionId: Int? {
        audiobookEdition?.id ?? book.audiobookEditionId
    }

    /// Falls back to the list item so reading progress still resolves when the
    /// detail request failed but the library already knew the edition.
    var ebookEditionId: Int? {
        ebookEdition?.id ?? book.ebookEditionId
    }

    var ebookStorageEditionId: Int {
        ebookEditionId ?? (1_000_000_000 + book.bookId)
    }

    var hasAudiobookEdition: Bool {
        audiobookEditionId != nil
    }

    var hasEbookEdition: Bool {
        ebookEdition != nil || book.hasEbook
    }

    /// The shared library list wins: setBookRead refreshes it, whereas this screen's own
    /// `detail` copy was not reliably re-rendered after a toggle.
    var isRead: Bool {
        if let listed = model.library.first(where: { $0.bookId == book.bookId }) {
            return listed.isRead
        }
        if let detail {
            return detail.readAt != nil
        }
        return book.isRead
    }

    /// Same list as the card long-press; Read and Play are the page's own primary buttons.
    var menuItems: [BookCardMenuAction] {
        let hasProgress = [audiobookEditionId, ebookEditionId].compactMap(\.self).contains {
            model.resumePreview[$0] != nil || model.readingResumePreview[$0] != nil
        }
        return bookCardMenuItems(
            hasAudiobook: hasAudiobookEdition,
            hasEbook: hasEbookEdition,
            isAdmin: model.isAdmin,
            isRead: isRead,
            hasProgress: hasProgress,
            audiobookDownloaded: audiobookEditionId.map { model.downloadPlans[$0]?.isComplete == true } ?? false
        )
        .filter { $0 != .read && $0 != .play }
    }

    func handleMenu(_ action: BookCardMenuAction) {
        guard !(action.requiresConnection && model.isOffline) else { return }
        switch action {
        case .read, .play:
            break
        case .markRead:
            model.confirmBookAction(.markRead(book)) { await loadBookDetail() }
        case .markUnread:
            Task { await model.setBookRead(book, read: false) }
        case .resetProgress:
            model.confirmBookAction(.resetProgress(book)) { await loadBookDetail() }
        case .download:
            if let editionId = audiobookEditionId {
                Task { await model.startDownload(editionId: editionId) }
            }
        case .removeDownload:
            model.confirmBookAction(.removeDownload(book)) { await loadBookDetail() }
        case .addAudiobook:
            Task { await addEdition(kind: "audiobook") }
        case .addEbook:
            Task { await addEdition(kind: "ebook") }
        case .rescan:
            Task {
                if hasAudiobookEdition {
                    await recoverManifestAfterRescan()
                }
                if hasEbookEdition {
                    await rescanEbookEdition()
                }
            }
        }
    }

    var titleText: String {
        detail?.title ?? book.title
    }

    var subtitleText: String? {
        detail?.subtitle
    }

    var authorText: String {
        let authors = detail?.authors ?? (book.author.map { [$0] } ?? [])
        return authors.joined(separator: ", ")
    }

    var coverURL: URL? {
        model.absoluteURL(detail?.coverUrl) ?? book.coverURL
    }

    var audiobookSummary: LibrarySummary? {
        guard let editionId = audiobookEditionId else { return nil }
        return LibrarySummary(
            editionId: editionId,
            bookId: book.bookId,
            title: titleText,
            author: authorText.isEmpty ? nil : authorText,
            coverURL: coverURL,
            durationSecs: audiobookEdition?.durationSecs ?? book.audiobookDurationSecs
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                hero
                VStack(alignment: .leading, spacing: 18) {
                    lanePicker
                    if let detailError, detail == nil {
                        errorBanner(detailError)
                    }
                    laneContent
                    metadataCard
                    overviewCard
                }
                .padding(.horizontal, 16)
            }
            // Cap to a readable measure and center on iPad/Mac; full-bleed on phone.
            .frame(maxWidth: isRegularWidth ? 980 : .infinity)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 24)
        }
        .background(Theme.base)
        .navigationTitle(titleText)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                BookActionsMenu(items: menuItems, onAction: handleMenu)
            }
        }
        .rawkoonZoomDestination(RawkoonZoom.book(book.bookId))
        .onAppear {
            seedDetailFromCache()
            seedManifestFromCache()
        }
        // `.task(id:)` covers both the initial load and live `/api/library/events`
        // book updates, and — unlike a bare `onChange { Task { … } }` — cancels an
        // in-flight refresh before starting the next, so a burst of events can't
        // run overlapping reloads.
        .task(id: model.bookChangeToken) {
            await refreshAll(forceManifestRefresh: false)
        }
        // Painted from saved data while the server was out of reach: refetch once it's back.
        .onChange(of: model.reconnectToken) { _, _ in
            Task { await refreshAll(forceManifestRefresh: false) }
        }
        .refreshable {
            await refreshAll(forceManifestRefresh: true)
        }
        .sheet(isPresented: $showingPlayer, onDismiss: {
            Task { await loadResumePreview() }
        }) {
            if let manifest, let summary = audiobookSummary {
                PlayerView(summary: summary, manifest: manifest)
                    .environment(model)
            }
        }
        .sheet(item: $releaseSearchLane, onDismiss: {
            Task {
                await model.loadLibrary()
                await loadBookDetail()
                if hasEbookEdition {
                    await loadEbookFiles()
                }
                if hasAudiobookEdition {
                    await fetchManifest(forceRefresh: true)
                }
            }
        }) { lane in
            BookReleaseSearchView(bookId: book.bookId, kind: lane.rawValue, title: titleText)
                .environment(model)
        }
        .sheet(item: $previewDocument, onDismiss: {
            Task { await loadReadingResumePreview() }
        }) { document in
            EbookReaderSheet(document: document)
                .environment(model)
        }
    }

    // MARK: Header

    var hero: some View {
        BookHero(
            title: titleText,
            subtitle: subtitleText,
            author: authorText,
            coverURL: coverURL,
            metaLine: factsLine
        ) {
            if isRead {
                chip(Text(verbatim: bookReadStatusText()), tint: Theme.seed)
            }
        }
    }

    var factsLine: String? {
        guard let detail else { return nil }
        var parts: [String] = []
        if let published = formattedPublishedDate(detail.publishedDate, year: detail.publishedYear) {
            parts.append(published)
        }
        parts.append(detail.language.uppercased())
        if let name = detail.seriesName, !name.isEmpty {
            let suffix = detail.seriesPosition.map { " #\($0)" } ?? ""
            parts.append("\(name)\(suffix)")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var lanePicker: some View {
        Picker("Edition", selection: $activeLane) {
            ForEach(BookDetailLane.allCases) { lane in
                Text(lane.title).tag(lane)
            }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    var laneContent: some View {
        switch activeLane {
        case .audiobook:
            BookAudiobookView(
                page: self, audioState: audiobookState,
                showingPlayer: $showingPlayer, chapterFilter: $chapterFilter
            )
        case .ebook:
            BookEbookView(page: self, state: ebookState)
        }
    }

    func chip(_ text: Text, tint: Color) -> some View {
        text
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }

    func errorBanner(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Book details couldn't load")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textStrong)
            Text(message)
                .font(.caption)
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.terracotta.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.terracotta.opacity(0.3), lineWidth: 1))
    }

    /// Runtime the resume label is measured against: the manifest is
    /// authoritative, but the detail row answers before it loads.
    var audiobookTotalSecs: Double {
        manifest?.totalDurationSecs ?? audiobookEdition?.durationSecs ?? book.audiobookDurationSecs ?? 0
    }

    var audiobookResume: AudiobookResumeLabel {
        guard let editionId = audiobookEditionId else { return .play }
        return AudiobookResume.label(
            positionSecs: model.resumePreview[editionId],
            totalDurationSecs: audiobookTotalSecs
        )
    }

    var ebookResume: EbookResumeLabel {
        guard let editionId = ebookEditionId else { return .read }
        return EbookResume.label(model.readingResumePreview[editionId])
    }

    var canPlayAudiobook: Bool {
        guard let manifest else { return false }
        return !manifest.chapters.isEmpty
    }

    func metricsCard(title: LocalizedStringKey, status: String, accent: Color, metrics: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                chip(LocalizedStatus.text(status), tint: accent)
            }
            if !metrics.isEmpty {
                Text(metrics.joined(separator: " · "))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    func missingEditionCard(
        title: LocalizedStringKey,
        description: LocalizedStringKey,
        buttonTitle: LocalizedStringKey,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)
            Text(description)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
            Button(action: action) {
                if addingEditionKind != nil {
                    ProgressView()
                        .tint(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                } else {
                    Label(buttonTitle, systemImage: "plus.circle")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(tint)
            .foregroundStyle(Theme.onAccent)
            .disabled(addingEditionKind != nil)
            .requiresConnection(model.isOffline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }
}

/// Debug trace: logs each distinct state the book screen computes, so a screen that
/// stays on a finished ring can be told apart from one that never re-evaluated.
final class DownloadStateProbe {
    private var last = ""

    func note(editionId: Int, summary: String) {
        guard summary != last else { return }
        last = summary
        DownloadJournal(editionId: editionId).log("ui eval \(summary)")
    }
}
