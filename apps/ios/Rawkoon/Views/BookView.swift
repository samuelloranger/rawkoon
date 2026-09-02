import Foundation
import RawkoonKit
import SwiftUI

enum BookDetailLane: String, CaseIterable, Identifiable {
    case audiobook = "Audiobook"
    case ebook = "Ebook"
    var id: String {
        rawValue
    }
}

private enum ReleaseSearchLane: String, Identifiable {
    case audiobook
    case ebook
    var id: String {
        rawValue
    }
}

struct BookView: View {
    @Environment(AppModel.self) private var model

    let book: BookListItem

    @State private var vm: BookViewModel
    @State private var activeLane: BookDetailLane

    @State private var showingPlayer = false
    @State private var releaseSearchLane: ReleaseSearchLane?
    @State private var openingEbookFileId: Int?
    @State private var downloadingEbookFileIDs = Set<Int>()
    @State private var previewDocument: EbookPreviewDocument?
    @State private var chapterFilter = ""

    /// Longer than one screen of spine rows; a 3-chapter book does not need a field.
    private let chapterFilterThreshold = 12

    init(book: BookListItem, preferEbook: Bool = false) {
        self.book = book
        _vm = State(initialValue: BookViewModel(book: book))
        if preferEbook, book.hasEbook {
            _activeLane = State(initialValue: .ebook)
        } else {
            _activeLane = State(initialValue: book.hasAudiobook ? .audiobook : .ebook)
        }
    }

    private var titleText: String {
        vm.detail?.title ?? book.title
    }

    private var subtitleText: String? {
        vm.detail?.subtitle
    }

    private var authorText: String {
        let authors = vm.detail?.authors ?? (book.author.map { [$0] } ?? [])
        return authors.joined(separator: ", ")
    }

    private var coverURL: URL? {
        model.absoluteURL(vm.detail?.coverUrl) ?? book.coverURL
    }

    private var audiobookSummary: LibrarySummary? {
        guard let editionId = vm.audiobookEditionId else { return nil }
        return LibrarySummary(
            editionId: editionId,
            bookId: book.bookId,
            title: titleText,
            author: authorText.isEmpty ? nil : authorText,
            coverURL: coverURL,
            durationSecs: vm.audiobookEdition?.durationSecs ?? book.audiobookDurationSecs
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                lanePicker
                if let detailError = vm.detailError, vm.detail == nil {
                    errorBanner(detailError)
                }
                laneContent
                metadataCard
                overviewCard
            }
            .padding(16)
        }
        .background(Theme.base)
        .navigationTitle(titleText)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await vm.refreshAll(model: model, forceManifestRefresh: false)
            activeLane = vm.alignedLane(current: activeLane)
        }
        .refreshable {
            await vm.refreshAll(model: model, forceManifestRefresh: true)
            activeLane = vm.alignedLane(current: activeLane)
        }
        .sheet(isPresented: $showingPlayer) {
            if let manifest = vm.manifest, let summary = audiobookSummary {
                PlayerView(summary: summary, manifest: manifest)
                    .environment(model)
            }
        }
        .sheet(item: $releaseSearchLane, onDismiss: {
            Task {
                await vm.onReleaseSearchDismissed(model: model)
                activeLane = vm.alignedLane(current: activeLane)
            }
        }) { lane in
            BookReleaseSearchView(bookId: book.bookId, kind: lane.rawValue, title: titleText)
                .environment(model)
        }
        .sheet(item: $previewDocument) { document in
            EbookReaderSheet(document: document)
                .environment(model)
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            BookCover(url: coverURL, size: 96, corner: 12)
                .shadow(color: .black.opacity(0.5), radius: 12, y: 8)

            VStack(alignment: .leading, spacing: 6) {
                Text(titleText)
                    .font(.display(20))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(3)
                if let subtitleText, !subtitleText.isEmpty {
                    Text(subtitleText)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                if !authorText.isEmpty {
                    Text(authorText)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                if let facts = vm.factsLine {
                    Text(facts)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
                HStack(spacing: 6) {
                    if vm.hasAudiobookEdition {
                        let audiobookStatus = vm.formattedStatus(vm.audiobookEdition?.status ?? book.audiobookStatus ?? "wanted")
                        chip("Audiobook · \(audiobookStatus)", tint: Theme.muted)
                    }
                    if vm.hasEbookEdition {
                        chip("Ebook · \(vm.formattedStatus(vm.ebookEdition?.status ?? "wanted"))", tint: Theme.muted)
                    }
                }
                .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
    }

    private var lanePicker: some View {
        Picker("Edition", selection: $activeLane) {
            ForEach(BookDetailLane.allCases) { lane in
                Text(lane.rawValue).tag(lane)
            }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    private var laneContent: some View {
        if vm.loadingDetail, vm.detail == nil {
            HStack {
                Spacer()
                ProgressView().tint(Theme.apricot)
                Spacer()
            }
        } else {
            switch activeLane {
            case .audiobook:
                audiobookSection
            case .ebook:
                ebookSection
            }
        }
    }

    private var overviewCard: some View {
        Group {
            if let overview = vm.detail?.overview, !overview.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Overview")
                        .font(.display(16))
                        .foregroundStyle(Theme.textStrong)
                    Text(vm.renderedOverviewText(overview))
                        .font(.subheadline)
                        .foregroundStyle(Theme.text)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
            }
        }
    }

    private var metadataCard: some View {
        Group {
            if !vm.metadataRows.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Book info")
                        .font(.display(16))
                        .foregroundStyle(Theme.textStrong)
                    ForEach(Array(vm.metadataRows.enumerated()), id: \.offset) { entry in
                        let row = entry.element
                        HStack(alignment: .top) {
                            Text(row.label)
                                .font(.caption)
                                .foregroundStyle(Theme.faint)
                            Spacer(minLength: 12)
                            Text(row.value)
                                .font(.subheadline)
                                .foregroundStyle(Theme.text)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
            }
        }
    }

    private func chip(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }

    private func errorBanner(_ message: String) -> some View {
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
    private var audiobookSection: some View {
        if vm.hasAudiobookEdition {
            VStack(alignment: .leading, spacing: 14) {
                metricsCard(
                    title: "Audiobook",
                    status: vm.audiobookEdition?.status ?? book.audiobookStatus ?? "wanted",
                    accent: Theme.muted,
                    metrics: vm.audiobookMetrics
                )
                audiobookActionButtons
                chaptersList
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

    private var audiobookActionButtons: some View {
        VStack(spacing: 10) {
            Button {
                Task {
                    if await vm.playAudiobook(model: model) {
                        showingPlayer = true
                    }
                }
            } label: {
                Group {
                    if vm.loadingPlayer {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Label("Play", systemImage: "play.fill")
                    }
                }
                .frame(maxWidth: .infinity).frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.apricot)
            .foregroundStyle(Theme.onAccent)
            .fontWeight(.semibold)
            .disabled(!vm.canPlayAudiobook || vm.loadingManifest)

            audiobookDownloadButton

            if model.isAdmin {
                HStack(spacing: 10) {
                    Button {
                        releaseSearchLane = .audiobook
                    } label: {
                        Label("Search releases", systemImage: "magnifyingglass")
                            .frame(maxWidth: .infinity)
                            .frame(height: 22)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.apricot)

                    if vm.manifest == nil {
                        Button {
                            Task {
                                guard let client = model.api() else { return }
                                await vm.recoverManifestAfterRescan(client: client, model: model)
                                activeLane = vm.alignedLane(current: activeLane)
                            }
                        } label: {
                            Group {
                                if vm.rescanningManifest {
                                    ProgressView().tint(Theme.apricot)
                                } else {
                                    Label("Rescan", systemImage: "arrow.clockwise")
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 22)
                        }
                        .buttonStyle(.bordered)
                        .tint(Theme.raised)
                        .disabled(vm.rescanningManifest || vm.loadingManifest)
                    }
                }
            }

            if let audiobookActionError = vm.audiobookActionError {
                Text(audiobookActionError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
            }
        }
    }

    @ViewBuilder
    private var audiobookDownloadButton: some View {
        let plan = vm.audiobookEditionId.flatMap { model.downloadPlans[$0] }
        if vm.preparingAudiobookDownload, plan == nil {
            HStack {
                ProgressView().tint(Theme.apricot)
                Text("Preparing download...")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.muted)
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.borderStrong, lineWidth: 1))
        } else if let plan, !plan.isComplete {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Downloading")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.textStrong)
                    Spacer()
                    Text("\(Int(plan.progressFraction() * 100))%")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.apricot)
                }
                DuskProgress(value: plan.progressFraction())
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.borderStrong, lineWidth: 1))
        } else if plan?.isComplete == true {
            Button {} label: {
                Label("Downloaded", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity).frame(height: 22)
            }
            .buttonStyle(.bordered)
            .tint(Theme.seed)
            .disabled(true)
        } else {
            Button {
                Task {
                    await vm.startAudiobookDownload(model: model)
                }
            } label: {
                Label("Download", systemImage: "arrow.down.circle")
                    .frame(maxWidth: .infinity).frame(height: 22)
            }
            .buttonStyle(.bordered)
            .tint(Theme.apricot)
        }
    }

    private var sortedChapters: [ManifestChapter] {
        (vm.manifest?.chapters ?? []).sorted(by: { $0.index < $1.index })
    }

    private var filteredChapters: [ManifestChapter] {
        filterChapters(sortedChapters, query: chapterFilter)
    }

    private var chaptersList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chapters")
                .font(.display(17))
                .foregroundStyle(Theme.textStrong)
            if vm.loadingManifest {
                ProgressView().tint(Theme.apricot)
            } else if vm.manifest != nil {
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
                        ForEach(filteredChapters, id: \.fileId) { chapter in
                            Button {
                                Task {
                                    if await vm.playAudiobook(model: model, chapter: chapter) {
                                        showingPlayer = true
                                    }
                                }
                            } label: {
                                SpineRow(
                                    index: chapter.index,
                                    title: chapter.title,
                                    downloaded: vm.isChapterDownloaded(chapter, model: model),
                                    current: vm.isCurrentChapter(chapter, model: model)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(vm.manifestError ?? "Chapters couldn't load.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                    Text("Pull to refresh, run rescan, or check the server.")
                        .font(.caption)
                        .foregroundStyle(Theme.faint)
                    Text("Edition status: \(vm.formattedStatus(vm.audiobookEdition?.status ?? book.audiobookStatus ?? "wanted"))")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
        }
    }

    // MARK: Ebook

    @ViewBuilder
    private var ebookSection: some View {
        if vm.hasEbookEdition {
            VStack(alignment: .leading, spacing: 14) {
                metricsCard(
                    title: "Ebook",
                    status: vm.ebookEdition?.status ?? "wanted",
                    accent: Theme.muted,
                    metrics: vm.ebookMetrics
                )
                ebookActions
                ebookFilesCard
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

    private var ebookActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            let preferred = vm.preferredEbookFile
            let preferredIsDownloaded = preferred.map(vm.isEbookDownloaded) ?? false
            let preferredCanFetchRemote = preferred.flatMap { vm.remoteEbookURL(for: $0, model: model) } != nil
            let preferredCanRead = preferredIsDownloaded || preferredCanFetchRemote

            Button {
                Task {
                    guard let file = vm.preferredEbookFile else { return }
                    await openEbook(file)
                }
            } label: {
                Label("Read", systemImage: "book.pages")
                    .frame(maxWidth: .infinity).frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.terracotta)
            .foregroundStyle(Theme.onAccent)
            .disabled(!preferredCanRead || vm.loadingEbookFiles || openingEbookFileId != nil)

            if let preferred = vm.preferredEbookFile {
                if preferredIsDownloaded {
                    Label("Saved for offline reading", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Theme.seed)
                } else if preferredCanFetchRemote {
                    Button {
                        Task { await downloadEbook(preferred) }
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
                        .frame(maxWidth: .infinity).frame(height: 22)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.muted)
                    .disabled(downloadingEbookFileIDs.contains(preferred.id) || vm.loadingEbookFiles)
                } else {
                    Text("This server does not expose secure ebook file downloads yet. Update Rawkoon on the server, then retry.")
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }

            if model.isAdmin {
                HStack(spacing: 10) {
                    Button {
                        releaseSearchLane = .ebook
                    } label: {
                        Label("Search releases", systemImage: "magnifyingglass")
                            .frame(maxWidth: .infinity).frame(height: 22)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.muted)

                    Button {
                        Task {
                            guard let client = model.api() else { return }
                            await vm.rescanEbookEdition(client: client, model: model)
                            activeLane = vm.alignedLane(current: activeLane)
                        }
                    } label: {
                        Group {
                            if vm.rescanningEbook {
                                ProgressView().tint(Theme.muted)
                            } else {
                                Label("Rescan", systemImage: "arrow.clockwise")
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 22)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.raised)
                    .disabled(vm.rescanningEbook || vm.loadingEbookFiles)
                }
            }
            if let ebookFilesError = vm.ebookFilesError {
                Text(ebookFilesError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
            }
        }
    }

    private var ebookFilesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Files")
                .font(.display(17))
                .foregroundStyle(Theme.textStrong)

            if vm.loadingEbookFiles {
                ProgressView().tint(Theme.muted)
            } else if vm.ebookFiles.isEmpty {
                Text("No ebook files imported yet. Search releases or rescan this edition.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(vm.ebookFiles) { file in
                    HStack(alignment: .top, spacing: 10) {
                        let downloaded = vm.isEbookDownloaded(file)
                        let downloading = downloadingEbookFileIDs.contains(file.id)
                        let loadingState = openingEbookFileId == file.id || downloading
                        let canFetchRemote = vm.remoteEbookURL(for: file, model: model) != nil

                        VStack(alignment: .leading, spacing: 3) {
                            Text(file.fileName)
                                .font(.subheadline)
                                .foregroundStyle(Theme.textStrong)
                                .lineLimit(2)
                            Text(vm.fileMeta(file))
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        if loadingState {
                            ProgressView().tint(Theme.muted)
                        } else {
                            HStack(spacing: 7) {
                                if downloaded {
                                    StatusBadge(text: "Offline", tint: Theme.seed)
                                } else {
                                    Button("Download") {
                                        Task { await downloadEbook(file) }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.muted)
                                    .disabled(!canFetchRemote)
                                }

                                if vm.isReadableEbook(file) {
                                    Button("Read") {
                                        Task { await openEbook(file) }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.muted)
                                    .disabled(!downloaded && !canFetchRemote)
                                } else {
                                    StatusBadge(text: "Ebook only", tint: Theme.muted)
                                }
                            }
                        }
                    }
                    .padding(11)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
                }
            }
        }
    }

    private func metricsCard(title: String, status: String, accent: Color, metrics: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                chip(vm.formattedStatus(status), tint: accent)
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

    private func missingEditionCard(
        title: String,
        description: String,
        buttonTitle: String,
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
                if vm.addingEditionKind != nil {
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
            .disabled(vm.addingEditionKind != nil)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: View-owned wrappers around VM calls
    //
    // These keep the view-state pieces (`activeLane`, `openingEbookFileId`,
    // `downloadingEbookFileIDs`, `previewDocument`) out of `BookViewModel`,
    // which never touches SwiftUI `@State`.

    /// `activeLane` is view-state, so `addEdition`'s original unconditional
    /// post-add lane assignment (which overrode whatever
    /// `alignLaneToAvailableEditions()` had just computed inside the nested
    /// `loadBookDetail()` call) happens here instead, gated on
    /// `AddEditionOutcome.succeeded` exactly as the original's `do` block was.
    private func addEdition(kind: String) async {
        guard let client = model.api() else { return }
        switch await vm.addEdition(client: client, model: model, kind: kind) {
        case .succeeded:
            activeLane = kind == "audiobook" ? .audiobook : .ebook
        case .failed:
            break
        }
    }

    /// `openingEbookFileId` is a view-owned per-row progress flag;
    /// `previewDocument` is the view's sheet-presentation state.
    private func openEbook(_ file: BookEditionFile) async {
        openingEbookFileId = file.id
        defer { openingEbookFileId = nil }
        if let localURL = await vm.openEbook(file, model: model) {
            previewDocument = EbookPreviewDocument(
                id: file.id,
                // The real edition id, not ebookStorageEditionId: reading
                // progress is stored server-side per edition, and the synthetic
                // fallback id does not exist there.
                editionId: vm.ebookEditionId,
                // Rawkoon's language, not the EPUB's: an EPUB can list several
                // and the reader takes the first, which laid a French novel out
                // right-to-left.
                language: vm.detail?.language,
                title: file.fileName,
                localURL: localURL
            )
        }
    }

    /// `downloadingEbookFileIDs` is a view-owned in-flight set.
    private func downloadEbook(_ file: BookEditionFile) async {
        guard !downloadingEbookFileIDs.contains(file.id) else { return }
        downloadingEbookFileIDs.insert(file.id)
        defer { downloadingEbookFileIDs.remove(file.id) }
        await vm.downloadEbook(file, model: model)
    }
}
