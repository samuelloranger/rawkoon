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
    @State var preparingAudiobookDownload = false
    @State var showDownloadFinished = false
    /// Bumped by the download-state notification so the buttons re-evaluate even when Observation misses it.
    @State var downloadRefreshTick = 0
    @State var stateProbe = DownloadStateProbe()
    @State var loadingPlayer = false
    @State var showingPlayer = false
    @State var releaseSearchLane: ReleaseSearchLane?
    @State var manifestError: String?
    @State var audiobookActionError: String?
    @State var attemptedAutomaticRecovery = false

    @State var ebookFiles: [BookEditionFile] = []
    @State var loadingEbookFiles = false
    @State var rescanningEbook = false
    @State var openingEbookFileId: Int?
    @State var downloadingEbookFileIDs = Set<Int>()
    /// Live ebook download tasks, kept so a Cancel tap can stop the underlying
    /// URLSession request mid-flight (`session.download(for:)` honors Task
    /// cancellation).
    @State var ebookDownloadTasks: [Int: Task<Void, Never>] = [:]
    /// The ebook file awaiting a delete confirmation, or nil when none is.
    @State var ebookFilesError: String?
    @State var previewDocument: EbookPreviewDocument?
    @State var addingEditionKind: String?
    @State var chapterFilter = ""

    /// Longer than one screen of spine rows; a 3-chapter book does not need a field.
    let chapterFilterThreshold = 12

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
            audiobookSection
        case .ebook:
            ebookSection
        }
    }

    /// Admin-only per-lane management, mirroring the media detail's Management
    /// card: release search (the card's primary action) plus a rescan. Keeps
    /// these off the reader/listener action stack above.
    @ViewBuilder
    func bookManagementCard(lane: BookDetailLane) -> some View {
        if model.isAdmin {
            let rescanning = lane == .audiobook ? rescanningManifest : rescanningEbook
            let rescanDisabled = lane == .audiobook
                ? (rescanningManifest || loadingManifest)
                : (rescanningEbook || loadingEbookFiles)
            VStack(alignment: .leading, spacing: 12) {
                Text("Management")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)

                Button {
                    releaseSearchLane = lane == .audiobook ? .audiobook : .ebook
                } label: {
                    Label("Search releases", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.apricot)
                .foregroundStyle(Theme.onAccent)
                .fontWeight(.semibold)
                .requiresConnection(model.isOffline)

                Button {
                    Task {
                        if lane == .audiobook {
                            await recoverManifestAfterRescan()
                        } else {
                            await rescanEbookEdition()
                        }
                    }
                } label: {
                    Group {
                        if rescanning {
                            ProgressView().tint(Theme.muted)
                        } else {
                            Label("Rescan", systemImage: "arrow.clockwise")
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
                .disabled(rescanDisabled)
                .requiresConnection(model.isOffline)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
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

    // MARK: Audiobook

    @ViewBuilder
    var audiobookSection: some View {
        if hasAudiobookEdition {
            VStack(alignment: .leading, spacing: 14) {
                metricsCard(
                    title: "Audiobook",
                    status: audiobookEdition?.status ?? book.audiobookStatus ?? "wanted",
                    accent: Theme.muted,
                    metrics: audiobookMetrics
                )
                audiobookActionButtons
                chaptersList
                bookManagementCard(lane: .audiobook)
            }
        } else {
            missingEditionCard(
                title: "Audiobook edition missing",
                description: "Add an audiobook edition, then search releases to play and download chapters offline.",
                buttonTitle: "Add audiobook",
                tint: Theme.terracotta,
                action: { Task { await addEdition(kind: "audiobook") } }
            )
        }
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

    var audiobookMetrics: [String] {
        let secs = manifest?.totalDurationSecs ?? audiobookEdition?.durationSecs ?? book.audiobookDurationSecs ?? 0
        var parts = [Formatters.durationClock(secs)]
        if let count = manifest?.chapters.count {
            parts.append(String(localized: "\(count) chapters"))
        } else if let count = audiobookEdition?.fileCount {
            parts.append(String(localized: "\(count) files"))
        } else if book.audiobookFileCount > 0 {
            parts.append(String(localized: "\(book.audiobookFileCount) files"))
        }
        return parts
    }

    var audiobookActionButtons: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                audiobookPlayButton
                audiobookDownloadButton
            }
            audiobookDownloadCaption

            if let audiobookActionError {
                Text(audiobookActionError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .audiobookDownloadStateChanged)) { note in
            guard note.userInfo?["editionId"] as? Int == audiobookEditionId else { return }
            downloadRefreshTick &+= 1
            if let editionId = audiobookEditionId {
                DownloadJournal(editionId: editionId).log("ui refresh tick \(downloadRefreshTick)")
            }
        }
        .onChange(of: audiobookDownloadState.kind) { old, new in
            if let editionId = audiobookEditionId {
                DownloadJournal(editionId: editionId).log("ui download state \(old) -> \(new)")
            }
            guard old == .downloading, new == .downloaded else { return }
            announceDownloadFinished()
        }
    }

    /// The card used to flip to "Downloaded"; a glyph swap alone is easy to miss,
    /// so the finish gets a haptic and a brief green check.
    private func announceDownloadFinished() {
        RawkoonHaptics.play(.downloadComplete)
        withRawkoonMotion(.spring(duration: 0.35)) { showDownloadFinished = true }
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            withRawkoonMotion(.easeOut(duration: 0.3)) { showDownloadFinished = false }
        }
    }

    var audiobookPlayButton: some View {
        Button {
            Task {
                guard let editionId = audiobookEditionId else { return }
                audiobookActionError = nil
                loadingPlayer = true
                // "Play" has to mean from the start — but only once the
                // preview has loaded. Before that the label is a placeholder,
                // so the player resolves the position itself.
                let previewed = model.resumePreview[editionId] != nil
                let resumeAt: Double? = (previewed && audiobookResume == .play) ? 0 : nil
                await model.openPlayer(editionId: editionId, resumeAt: resumeAt)
                loadingPlayer = false
                if let error = model.errorMessage {
                    audiobookActionError = error
                } else {
                    showingPlayer = true
                }
            }
        } label: {
            Group {
                if loadingPlayer {
                    ProgressView().tint(Theme.onAccent)
                } else if case let .resume(positionSecs) = audiobookResume {
                    Label(
                        String(localized: "Resume from \(Formatters.durationTimestamp(positionSecs))"),
                        systemImage: "play.fill"
                    )
                } else {
                    Label("Play", systemImage: "play.fill")
                }
            }
        }
        .buttonStyle(BookPlayButtonStyle())
        .disabled(!canPlayAudiobook)
    }

    var audiobookDownloadState: AudiobookDownloadState {
        let state = computeAudiobookDownloadState()
        if let editionId = audiobookEditionId {
            let plan = model.downloadPlans[editionId]
            let verified = plan.map { p in p.files.filter { p.states[$0.id] == .verified }.count } ?? -1
            stateProbe.note(editionId: editionId, summary: "kind=\(state.kind) verified=\(verified) complete=\(plan?.isComplete == true) tick=\(downloadRefreshTick)")
        }
        return state
    }

    private func computeAudiobookDownloadState() -> AudiobookDownloadState {
        _ = downloadRefreshTick
        let plan = audiobookEditionId.flatMap { model.downloadPlans[$0] }
        // The downloader exists a moment before its first snapshot: stay on the spinner.
        if plan == nil, preparingAudiobookDownload || audiobookEditionId.map({ model.downloaders[$0] != nil }) == true {
            return .preparing
        }
        if let plan, !plan.isComplete {
            let overall = audiobookEditionId.flatMap { model.downloadFractions[$0] } ?? plan.progressFraction()
            let done = plan.files.filter { plan.states[$0.id] == .verified }.count
            return plan.hasGivenUp
                ? .failed(done: done, total: plan.files.count)
                : .downloading(fraction: overall, done: done, total: plan.files.count)
        }
        return plan?.isComplete == true ? .downloaded : .idle
    }

    /// One round button beside Play: download, then progress (tap cancels), then
    /// a struck-through download arrow once the book is on the device.
    @ViewBuilder
    var audiobookDownloadButton: some View {
        let state = audiobookDownloadState
        let button = Button {
            handleAudiobookDownloadTap(state)
        } label: {
            DownloadStateIcon(state: state, celebrating: showDownloadFinished)
        }
        .buttonStyle(BookIconButtonStyle())
        .accessibilityLabel(state.accessibilityLabel)
        switch state {
        case .idle, .failed:
            button.requiresConnection(model.isOffline)
        default:
            button
        }
    }

    @ViewBuilder
    var audiobookDownloadCaption: some View {
        switch audiobookDownloadState {
        case .failed:
            Text("Some chapters couldn't download.")
                .font(.caption)
                .foregroundStyle(Theme.terracotta)
        default:
            EmptyView()
        }
    }

    private func handleAudiobookDownloadTap(_ state: AudiobookDownloadState) {
        guard let editionId = audiobookEditionId else { return }
        switch state {
        case .idle, .failed:
            Task {
                audiobookActionError = nil
                preparingAudiobookDownload = true
                await model.startDownload(editionId: editionId)
                preparingAudiobookDownload = false
                if let error = model.errorMessage {
                    audiobookActionError = error
                }
            }
        case .preparing:
            break
        case .downloading:
            audiobookActionError = nil
            preparingAudiobookDownload = false
            model.cancelDownload(editionId: editionId)
        case .downloaded:
            model.pendingConfirm = ConfirmRequest(
                title: String(localized: "Remove downloaded audiobook?"),
                message: String(localized: "Deletes the offline chapters from this iPhone. Playback will need the network until you download them again."),
                confirmTitle: String(localized: "Remove Download")
            ) { [model] in
                model.removeDownload(editionId: editionId)
            }
        }
    }

    var sortedChapters: [ManifestChapter] {
        (manifest?.chapters ?? []).sorted(by: { $0.index < $1.index })
    }

    var filteredChapters: [ManifestChapter] {
        filterChapters(sortedChapters, query: chapterFilter)
    }

    var chaptersList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chapters")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
            switch chapterListPhase(
                loading: loadingManifest,
                fetchAttempted: fetchAttemptedManifest,
                hasChapters: !(manifest?.chapters.isEmpty ?? true),
                error: manifestError
            ) {
            case .loading:
                ProgressView().tint(Theme.apricot)
            case .ready:
                if sortedChapters.count > chapterFilterThreshold {
                    searchField("Filter chapters", text: $chapterFilter)
                }
                if filteredChapters.isEmpty {
                    if !chapterFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("No chapters match.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                    }
                } else {
                    VStack(spacing: 4) {
                        ForEach(filteredChapters, id: \.index) { chapter in
                            Button {
                                Task {
                                    guard let editionId = audiobookEditionId else { return }
                                    loadingPlayer = true
                                    await model.openPlayer(
                                        editionId: editionId,
                                        resumeAt: resumePosition(in: chapter) ?? chapter.startSecs
                                    )
                                    loadingPlayer = false
                                    if model.errorMessage == nil {
                                        showingPlayer = true
                                    }
                                }
                            } label: {
                                SpineRow(
                                    index: chapter.index,
                                    title: chapter.title,
                                    downloaded: isChapterDownloaded(chapter),
                                    current: isCurrentChapter(chapter),
                                    downloadFraction: audiobookEditionId.flatMap {
                                        model.chapterFractions[$0]?[chapter.fileId]
                                    },
                                    resumeText: resumePosition(in: chapter).map {
                                        String(localized: "Resume from \(Formatters.durationTimestamp($0))")
                                    }
                                )
                            }
                            .buttonStyle(.rawkoonPressable(scale: 0.98))
                        }
                    }
                }
            case let .failed(message):
                VStack(alignment: .leading, spacing: 6) {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                    Text("Pull to refresh, run rescan, or check the server.")
                        .font(.caption)
                        .foregroundStyle(Theme.faint)
                    (Text("Edition status: ") + LocalizedStatus.text(audiobookEdition?.status ?? book.audiobookStatus ?? "wanted"))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
        }
    }

    // MARK: Ebook

    @ViewBuilder
    var ebookSection: some View {
        if hasEbookEdition {
            VStack(alignment: .leading, spacing: 14) {
                metricsCard(
                    title: "Ebook",
                    status: ebookEdition?.status ?? "wanted",
                    accent: Theme.muted,
                    metrics: ebookMetrics
                )
                ebookActions
                ebookFilesCard
                bookManagementCard(lane: .ebook)
            }
        } else {
            missingEditionCard(
                title: "Ebook edition missing",
                description: "Add an ebook edition to read files directly in Rawkoon.",
                buttonTitle: "Add ebook",
                tint: Theme.muted,
                action: { Task { await addEdition(kind: "ebook") } }
            )
        }
    }

    var ebookMetrics: [String] {
        var parts: [String] = []
        if let count = ebookEdition?.fileCount {
            parts.append(String(localized: "\(count) files"))
        }
        if let bestFormat = ebookEdition?.bestFormat {
            parts.append(bestFormat.uppercased())
        }
        if let size = Formatters.bytesStrict(ebookEdition?.totalSizeBytes) {
            parts.append(size)
        }
        let offlineCount = ebookFiles.filter { isEbookDownloaded($0) }.count
        if offlineCount > 0 {
            parts.append("\(offlineCount) offline")
        }
        return parts
    }

    var ebookActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            let preferred = preferredEbookFile
            let preferredIsDownloaded = preferred.map(isEbookDownloaded) ?? false
            let preferredCanFetchRemote = preferred.flatMap { remoteEbookURL(for: $0) } != nil
            let preferredCanRead = preferredIsDownloaded || preferredCanFetchRemote

            Button {
                Task {
                    guard let file = preferredEbookFile else { return }
                    // "Read" means from the beginning — a finished book must not
                    // reopen on its last page.
                    await openEbook(file, startFromBeginning: ebookResume == .read)
                }
            } label: {
                Group {
                    switch ebookResume {
                    case .read:
                        Label("Read", systemImage: "book.pages")
                    case let .resumeChapter(title):
                        Label(String(localized: "Resume · \(title)"), systemImage: "book.pages")
                    case let .resumePercent(percent):
                        Label(String(localized: "Resume from \(percent)%"), systemImage: "book.pages")
                    }
                }
                .frame(maxWidth: .infinity).frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.terracotta)
            .foregroundStyle(Theme.onAccent)
            .disabled(!preferredCanRead || loadingEbookFiles || openingEbookFileId != nil)

            if let preferred = preferredEbookFile {
                if preferredIsDownloaded {
                    Label("Saved for offline reading", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Theme.seed)
                } else if preferredCanFetchRemote {
                    Button {
                        startEbookDownload(preferred)
                    } label: {
                        Group {
                            if downloadingEbookFileIDs.contains(preferred.id) {
                                HStack(spacing: 8) {
                                    ProgressView().tint(Theme.muted)
                                    Text("Downloading...")
                                }
                            } else {
                                Label("Download primary file", systemImage: "arrow.down.circle")
                            }
                        }
                        .frame(maxWidth: .infinity).frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.muted)
                    .disabled(downloadingEbookFileIDs.contains(preferred.id) || loadingEbookFiles)
                    .requiresConnection(model.isOffline)
                } else {
                    Text("This server does not expose secure ebook file downloads yet. Update Rawkoon on the server, then retry.")
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }

            if let ebookFilesError {
                Text(ebookFilesError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
            }
        }
    }

    var ebookFilesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Files")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)

            if loadingEbookFiles {
                ProgressView().tint(Theme.muted)
            } else if ebookFiles.isEmpty {
                Text("No ebook files imported yet. Search releases or rescan this edition.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(ebookFiles) { file in
                    HStack(alignment: .top, spacing: 10) {
                        let downloaded = isEbookDownloaded(file)
                        let downloading = downloadingEbookFileIDs.contains(file.id)
                        let loadingState = openingEbookFileId == file.id || downloading
                        let canFetchRemote = remoteEbookURL(for: file) != nil

                        VStack(alignment: .leading, spacing: 3) {
                            Text(file.fileName)
                                .font(.subheadline)
                                .foregroundStyle(Theme.textStrong)
                                .lineLimit(2)
                            Text(fileMeta(file))
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        if downloading {
                            HStack(spacing: 7) {
                                ProgressView().tint(Theme.muted)
                                Button("Cancel") {
                                    cancelEbookDownload(file)
                                }
                                .buttonStyle(.bordered)
                                .tint(Theme.terracotta)
                                .lineLimit(1)
                            }
                            .fixedSize()
                        } else if loadingState {
                            ProgressView().tint(Theme.muted)
                        } else {
                            // Actions hold their intrinsic width; the file name (which
                            // wraps to two lines) yields the remaining space, so labels
                            // like "Retirer" never break character-by-character.
                            HStack(spacing: 7) {
                                if downloaded {
                                    Button("Remove") {
                                        model.pendingConfirm = ConfirmRequest(
                                            title: String(localized: "Remove downloaded file?"),
                                            message: String(localized: "Deletes \(file.fileName) from this iPhone. You can download it again anytime."),
                                            confirmTitle: String(localized: "Remove Download")
                                        ) { removeEbookDownload(file) }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.terracotta)
                                    .lineLimit(1)
                                } else {
                                    Button("Download") {
                                        startEbookDownload(file)
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.muted)
                                    .lineLimit(1)
                                    .disabled(!canFetchRemote)
                                    .requiresConnection(model.isOffline)
                                }

                                if isReadableEbook(file) {
                                    Button("Read") {
                                        Task { await openEbook(file) }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.muted)
                                    .lineLimit(1)
                                    .disabled(!downloaded && !canFetchRemote)
                                } else {
                                    StatusBadge(text: "Ebook only", tint: Theme.muted)
                                }
                            }
                            .fixedSize()
                        }
                    }
                    .padding(11)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
                }
            }
        }
    }

    /// The in-app reader unpacks EPUB only. Other formats in the library (the
    /// Harry Potter editions ship a .mobi beside each .epub) are downloadable
    /// but not readable here, and offering Read on them just produces a "not a
    /// valid EPUB container" error.
    func isReadableEbook(_ file: BookEditionFile) -> Bool {
        ebookExtension(for: file) == "epub" || file.format.lowercased() == "epub"
    }

    var preferredEbookFile: BookEditionFile? {
        ebookFiles
            .sorted { left, right in
                ebookFormatRank(left.format) < ebookFormatRank(right.format)
            }
            .first(where: isReadableEbook)
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
