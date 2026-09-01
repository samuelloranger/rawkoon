import Foundation
import RawkoonKit
import SwiftUI

private enum BookDetailLane: String, CaseIterable, Identifiable {
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
    @EnvironmentObject private var model: AppModel

    let book: BookListItem

    @State private var detail: BookDetailItem?
    @State private var loadingDetail = false
    @State private var detailError: String?
    @State private var activeLane: BookDetailLane

    @State private var manifest: BookManifest?
    @State private var loadingManifest = false
    @State private var rescanningManifest = false
    @State private var preparingAudiobookDownload = false
    @State private var loadingPlayer = false
    @State private var showingPlayer = false
    @State private var releaseSearchLane: ReleaseSearchLane?
    @State private var manifestError: String?
    @State private var audiobookActionError: String?
    @State private var attemptedAutomaticRecovery = false

    @State private var ebookFiles: [BookEditionFile] = []
    @State private var loadingEbookFiles = false
    @State private var rescanningEbook = false
    @State private var openingEbookFileId: Int?
    @State private var downloadingEbookFileIDs = Set<Int>()
    @State private var ebookFilesError: String?
    @State private var previewDocument: EbookPreviewDocument?
    @State private var addingEditionKind: String?
    @State private var chapterFilter = ""

    /// Longer than one screen of spine rows; a 3-chapter book does not need a field.
    private let chapterFilterThreshold = 12

    init(book: BookListItem, preferEbook: Bool = false) {
        self.book = book
        if preferEbook, book.hasEbook {
            _activeLane = State(initialValue: .ebook)
        } else {
            _activeLane = State(initialValue: book.hasAudiobook ? .audiobook : .ebook)
        }
    }

    private var audiobookEdition: BookEditionDetail? {
        detail?.editions.first(where: { $0.kind == "audiobook" })
    }

    private var ebookEdition: BookEditionDetail? {
        detail?.editions.first(where: { $0.kind == "ebook" })
    }

    private var audiobookEditionId: Int? {
        audiobookEdition?.id ?? book.audiobookEditionId
    }

    /// Falls back to the list item so reading progress still resolves when the
    /// detail request failed but the library already knew the edition.
    private var ebookEditionId: Int? {
        ebookEdition?.id ?? book.ebookEditionId
    }

    private var ebookStorageEditionId: Int {
        ebookEditionId ?? (1_000_000_000 + book.bookId)
    }

    private var hasAudiobookEdition: Bool {
        audiobookEditionId != nil
    }

    private var hasEbookEdition: Bool {
        ebookEdition != nil || book.hasEbook
    }

    private var titleText: String {
        detail?.title ?? book.title
    }

    private var subtitleText: String? {
        detail?.subtitle
    }

    private var authorText: String {
        let authors = detail?.authors ?? (book.author.map { [$0] } ?? [])
        return authors.joined(separator: ", ")
    }

    private var coverURL: URL? {
        model.absoluteURL(detail?.coverUrl) ?? book.coverURL
    }

    private var audiobookSummary: LibrarySummary? {
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
                header
                lanePicker
                if let detailError, detail == nil {
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
            await refreshAll(forceManifestRefresh: false)
        }
        .refreshable {
            await refreshAll(forceManifestRefresh: true)
        }
        .sheet(isPresented: $showingPlayer) {
            if let manifest, let summary = audiobookSummary {
                PlayerView(summary: summary, manifest: manifest)
                    .environmentObject(model)
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
                .environmentObject(model)
        }
        .sheet(item: $previewDocument) { document in
            EbookReaderSheet(document: document)
                .environmentObject(model)
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
                if let facts = factsLine {
                    Text(facts)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
                HStack(spacing: 6) {
                    if hasAudiobookEdition {
                        let audiobookStatus = formattedStatus(audiobookEdition?.status ?? book.audiobookStatus ?? "wanted")
                        chip("Audiobook · \(audiobookStatus)", tint: Theme.muted)
                    }
                    if hasEbookEdition {
                        chip("Ebook · \(formattedStatus(ebookEdition?.status ?? "wanted"))", tint: Theme.muted)
                    }
                }
                .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
    }

    private var factsLine: String? {
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
        if loadingDetail, detail == nil {
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
            if let overview = detail?.overview, !overview.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Overview")
                        .font(.display(16))
                        .foregroundStyle(Theme.textStrong)
                    Text(renderedOverviewText(overview))
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
            if !metadataRows.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Book info")
                        .font(.display(16))
                        .foregroundStyle(Theme.textStrong)
                    ForEach(Array(metadataRows.enumerated()), id: \.offset) { entry in
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

    private var metadataRows: [(label: String, value: String)] {
        guard let detail else { return [] }
        var rows: [(String, String)] = []
        if let isbn = detail.isbn13, !isbn.isEmpty {
            rows.append(("ISBN-13", isbn))
        }
        if !detail.narrators.isEmpty {
            rows.append(("Narrators", detail.narrators.joined(separator: ", ")))
        }
        if let publisher = detail.publisher, !publisher.isEmpty {
            rows.append(("Publisher", publisher))
        }
        if let pages = detail.pageCount {
            rows.append(("Pages", String(pages)))
        }
        if let rating = detail.rating {
            if let count = detail.ratingCount {
                rows.append(("Rating", "\(String(format: "%.1f", rating)) (\(count))"))
            } else {
                rows.append(("Rating", String(format: "%.1f", rating)))
            }
        }
        if !detail.genres.isEmpty {
            rows.append(("Genres", detail.genres.joined(separator: " · ")))
        }
        return rows
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

    private var audiobookMetrics: [String] {
        let secs = manifest?.totalDurationSecs ?? audiobookEdition?.durationSecs ?? book.audiobookDurationSecs ?? 0
        var parts = [formatDuration(secs)]
        if let count = manifest?.chapters.count {
            parts.append("\(count) chapters")
        } else if let count = audiobookEdition?.fileCount {
            parts.append("\(count) files")
        } else if book.audiobookFileCount > 0 {
            parts.append("\(book.audiobookFileCount) files")
        }
        return parts
    }

    private var audiobookActionButtons: some View {
        VStack(spacing: 10) {
            Button {
                Task {
                    guard let editionId = audiobookEditionId else { return }
                    audiobookActionError = nil
                    loadingPlayer = true
                    await model.openPlayer(editionId: editionId)
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
            .disabled(!canPlayAudiobook || loadingManifest)

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

                    if manifest == nil {
                        Button {
                            Task { await recoverManifestAfterRescan() }
                        } label: {
                            Group {
                                if rescanningManifest {
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
                        .disabled(rescanningManifest || loadingManifest)
                    }
                }
            }

            if let audiobookActionError {
                Text(audiobookActionError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
            }
        }
    }

    @ViewBuilder
    private var audiobookDownloadButton: some View {
        let plan = audiobookEditionId.flatMap { model.downloadPlans[$0] }
        if preparingAudiobookDownload, plan == nil {
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
                    if let editionId = audiobookEditionId {
                        audiobookActionError = nil
                        preparingAudiobookDownload = true
                        await model.startDownload(editionId: editionId)
                        preparingAudiobookDownload = false
                        if let error = model.errorMessage {
                            audiobookActionError = error
                        }
                    }
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
        (manifest?.chapters ?? []).sorted(by: { $0.index < $1.index })
    }

    private var filteredChapters: [ManifestChapter] {
        filterChapters(sortedChapters, query: chapterFilter)
    }

    private var chaptersList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chapters")
                .font(.display(17))
                .foregroundStyle(Theme.textStrong)
            if loadingManifest {
                ProgressView().tint(Theme.apricot)
            } else if manifest != nil {
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
                                    guard let editionId = audiobookEditionId else { return }
                                    loadingPlayer = true
                                    await model.openPlayer(editionId: editionId, resumeAt: chapter.startSecs)
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
                                    current: isCurrentChapter(chapter)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(manifestError ?? "Chapters couldn't load.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                    Text("Pull to refresh, run rescan, or check the server.")
                        .font(.caption)
                        .foregroundStyle(Theme.faint)
                    Text("Edition status: \(formattedStatus(audiobookEdition?.status ?? book.audiobookStatus ?? "wanted"))")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
        }
    }

    // MARK: Ebook

    @ViewBuilder
    private var ebookSection: some View {
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

    private var ebookMetrics: [String] {
        var parts: [String] = []
        if let count = ebookEdition?.fileCount {
            parts.append("\(count) files")
        }
        if let bestFormat = ebookEdition?.bestFormat {
            parts.append(bestFormat.uppercased())
        }
        if let size = formatBytes(ebookEdition?.totalSizeBytes) {
            parts.append(size)
        }
        let offlineCount = ebookFiles.filter { isEbookDownloaded($0) }.count
        if offlineCount > 0 {
            parts.append("\(offlineCount) offline")
        }
        return parts
    }

    private var ebookActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            let preferred = preferredEbookFile
            let preferredIsDownloaded = preferred.map(isEbookDownloaded) ?? false
            let preferredCanFetchRemote = preferred.flatMap { remoteEbookURL(for: $0) } != nil
            let preferredCanRead = preferredIsDownloaded || preferredCanFetchRemote

            Button {
                Task {
                    guard let file = preferredEbookFile else { return }
                    await openEbook(file)
                }
            } label: {
                Label("Read", systemImage: "book.pages")
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
                    .disabled(downloadingEbookFileIDs.contains(preferred.id) || loadingEbookFiles)
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
                        Task { await rescanEbookEdition() }
                    } label: {
                        Group {
                            if rescanningEbook {
                                ProgressView().tint(Theme.muted)
                            } else {
                                Label("Rescan", systemImage: "arrow.clockwise")
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 22)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.raised)
                    .disabled(rescanningEbook || loadingEbookFiles)
                }
            }
            if let ebookFilesError {
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

                                if isReadableEbook(file) {
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

    /// The in-app reader unpacks EPUB only. Other formats in the library (the
    /// Harry Potter editions ship a .mobi beside each .epub) are downloadable
    /// but not readable here, and offering Read on them just produces a "not a
    /// valid EPUB container" error.
    private func isReadableEbook(_ file: BookEditionFile) -> Bool {
        ebookExtension(for: file) == "epub" || file.format.lowercased() == "epub"
    }

    private var preferredEbookFile: BookEditionFile? {
        ebookFiles
            .sorted { left, right in
                ebookFormatRank(left.format) < ebookFormatRank(right.format)
            }
            .first(where: isReadableEbook)
    }

    private var canPlayAudiobook: Bool {
        guard let manifest else { return false }
        return !manifest.chapters.isEmpty
    }

    private func metricsCard(title: String, status: String, accent: Color, metrics: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                chip(formattedStatus(status), tint: accent)
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
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    /// The ebook lane loads before the audiobook manifest on purpose.
    ///
    /// A manifest 400 kicks off `recoverManifestAfterRescan()`, and a
    /// server-side rescan of a many-chapter edition re-reads every file's
    /// metadata — tens of seconds on a 60+ file audiobook. With the ebook load
    /// queued behind it, `ebookFiles` stayed empty for that whole window, which
    /// left "Read" disabled and the Files card spinning.
    private func refreshAll(forceManifestRefresh: Bool) async {
        await loadBookDetail()
        if hasEbookEdition {
            await loadEbookFiles()
        } else {
            ebookFiles = []
            ebookFilesError = nil
        }
        if hasAudiobookEdition {
            await fetchManifest(forceRefresh: forceManifestRefresh)
        } else {
            manifest = nil
            manifestError = nil
        }
    }

    private func loadBookDetail() async {
        guard let client = model.api() else { return }
        loadingDetail = true
        detailError = nil
        defer { loadingDetail = false }
        do {
            detail = try await client.bookDetail(bookId: book.bookId)
            alignLaneToAvailableEditions()
        } catch let apiError as APIError {
            detailError = message(for: apiError)
        } catch {
            detailError = "Could not load book details."
        }
    }

    private func alignLaneToAvailableEditions() {
        if activeLane == .audiobook, !hasAudiobookEdition, hasEbookEdition {
            activeLane = .ebook
        } else if activeLane == .ebook, !hasEbookEdition, hasAudiobookEdition {
            activeLane = .audiobook
        }
    }

    private func addEdition(kind: String) async {
        guard let client = model.api() else { return }
        addingEditionKind = kind
        defer { addingEditionKind = nil }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
            await loadBookDetail()
            if kind == "audiobook" {
                activeLane = .audiobook
                await fetchManifest(forceRefresh: true)
            } else {
                activeLane = .ebook
                await loadEbookFiles()
            }
        } catch let apiError as APIError {
            if kind == "audiobook" {
                manifestError = message(for: apiError)
            } else {
                ebookFilesError = message(for: apiError)
            }
        } catch {
            if kind == "audiobook" {
                manifestError = "Could not add audiobook edition."
            } else {
                ebookFilesError = "Could not add ebook edition."
            }
        }
    }

    private func fetchManifest(forceRefresh: Bool = false) async {
        guard let editionId = audiobookEditionId else { return }
        loadingManifest = true
        manifestError = nil
        defer { loadingManifest = false }
        do {
            manifest = try await model.manifest(editionId, forceRefresh: forceRefresh)
            attemptedAutomaticRecovery = false
        } catch let apiError as APIError {
            manifest = nil
            manifestError = message(for: apiError)
            if
                case .http(400) = apiError,
                model.isAdmin,
                !attemptedAutomaticRecovery,
                !forceRefresh
            {
                attemptedAutomaticRecovery = true
                await recoverManifestAfterRescan()
            }
        } catch {
            manifest = nil
            manifestError = "Could not load manifest."
        }
    }

    private func recoverManifestAfterRescan() async {
        guard let editionId = audiobookEditionId, let client = model.api() else { return }
        rescanningManifest = true
        defer { rescanningManifest = false }

        do {
            _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "audiobook")
            manifest = try await model.manifest(editionId, forceRefresh: true)
            manifestError = nil
            await model.loadLibrary()
            await loadBookDetail()
        } catch let apiError as APIError {
            manifest = nil
            manifestError = message(for: apiError)
        } catch {
            manifest = nil
            manifestError = "Rescan completed, but chapters are still unavailable."
        }
    }

    private func loadEbookFiles() async {
        guard hasEbookEdition, let client = model.api() else { return }
        loadingEbookFiles = true
        ebookFilesError = nil
        defer { loadingEbookFiles = false }
        do {
            ebookFiles = try await client.bookEditionFiles(bookId: book.bookId, kind: "ebook")
        } catch let apiError as APIError {
            ebookFiles = []
            ebookFilesError = message(for: apiError)
        } catch {
            ebookFiles = []
            ebookFilesError = "Could not load ebook files."
        }
    }

    private func rescanEbookEdition() async {
        guard let client = model.api() else { return }
        rescanningEbook = true
        defer { rescanningEbook = false }
        do {
            _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "ebook")
            await model.loadLibrary()
            await loadBookDetail()
            await loadEbookFiles()
        } catch let apiError as APIError {
            ebookFilesError = message(for: apiError)
        } catch {
            ebookFilesError = "Could not rescan ebook edition."
        }
    }

    private func openEbook(_ file: BookEditionFile) async {
        openingEbookFileId = file.id
        ebookFilesError = nil
        defer { openingEbookFileId = nil }
        do {
            let localURL = try await ensureLocalEbookFile(file)
            previewDocument = EbookPreviewDocument(
                id: file.id,
                // The real edition id, not ebookStorageEditionId: reading
                // progress is stored server-side per edition, and the synthetic
                // fallback id does not exist there.
                editionId: ebookEditionId,
                // Rawkoon's language, not the EPUB's: an EPUB can list several
                // and the reader takes the first, which laid a French novel out
                // right-to-left.
                language: detail?.language,
                title: file.fileName,
                localURL: localURL
            )
        } catch EbookStorageError.missingRemoteURL {
            ebookFilesError = "This server version cannot provide ebook download links yet."
        } catch {
            ebookFilesError = "Read failed. Try refreshing or rescanning this edition."
        }
    }

    private func downloadEbook(_ file: BookEditionFile) async {
        guard !downloadingEbookFileIDs.contains(file.id) else { return }
        downloadingEbookFileIDs.insert(file.id)
        ebookFilesError = nil
        defer { downloadingEbookFileIDs.remove(file.id) }
        do {
            _ = try await ensureLocalEbookFile(file)
        } catch EbookStorageError.missingRemoteURL {
            ebookFilesError = "This server version cannot provide ebook download links yet."
        } catch {
            ebookFilesError = "Download failed. Check your connection and try again."
        }
    }

    private func ensureLocalEbookFile(_ file: BookEditionFile) async throws -> URL {
        let localURL = localEbookURL(for: file)
        if FileManager.default.fileExists(atPath: localURL.path) {
            return localURL
        }

        guard let remoteURL = remoteEbookURL(for: file) else {
            throw EbookStorageError.missingRemoteURL
        }

        let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw APIError.transport
        }

        let parent = localURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)

        if FileManager.default.fileExists(atPath: localURL.path) {
            try FileManager.default.removeItem(at: localURL)
        }

        try FileManager.default.moveItem(at: temporaryURL, to: localURL)
        return localURL
    }

    private func remoteEbookURL(for file: BookEditionFile) -> URL? {
        guard let contentURL = file.contentUrl else { return nil }
        return model.absoluteURL(contentURL)
    }

    private func localEbookURL(for file: BookEditionFile) -> URL {
        return FileStore.chapterURL(
            editionId: ebookStorageEditionId,
            fileId: file.id,
            ext: ebookExtension(for: file)
        )
    }

    private func isEbookDownloaded(_ file: BookEditionFile) -> Bool {
        return FileStore.exists(
            editionId: ebookStorageEditionId,
            fileId: file.id,
            ext: ebookExtension(for: file)
        )
    }

    private func ebookExtension(for file: BookEditionFile) -> String {
        // Lowercased on purpose: the library holds both ".epub" and ".EPUB",
        // and the cached copy must land on one name either way.
        let ext = URL(fileURLWithPath: file.fileName).pathExtension.lowercased()
        if !ext.isEmpty {
            return ext
        }
        let normalized = file.format.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        return normalized.isEmpty ? "epub" : normalized
    }

    private func ebookFormatRank(_ format: String) -> Int {
        switch format.lowercased() {
        case "epub": return 0
        case "azw3": return 1
        case "mobi": return 2
        case "pdf": return 3
        case "cbz": return 4
        default: return 99
        }
    }

    private func fileMeta(_ file: BookEditionFile) -> String {
        var parts: [String] = [file.format.uppercased()]
        if let size = formatBytes(file.sizeBytes) {
            parts.append(size)
        }
        if let bitrate = file.audioBitrate {
            parts.append("\(bitrate) kbps")
        }
        if !file.languageTags.isEmpty {
            parts.append(file.languageTags.joined(separator: ", ").uppercased())
        }
        return parts.joined(separator: " · ")
    }

    private func formatBytes(_ raw: String?) -> String? {
        guard let raw, let bytes = Int64(raw), bytes > 0 else { return nil }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    private func renderedOverviewText(_ rawOverview: String) -> String {
        let trimmed = rawOverview.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("<"), let data = trimmed.data(using: .utf8) else {
            return trimmed
        }
        if let parsed = try? NSAttributedString(
            data: data,
            options: [
                .documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue,
            ],
            documentAttributes: nil
        ) {
            return parsed.string
                .replacingOccurrences(of: "\u{00A0}", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return trimmed
    }

    private func isChapterDownloaded(_ chapter: ManifestChapter) -> Bool {
        guard let editionId = audiobookEditionId else { return false }
        if model.downloadPlans[editionId]?.states[chapter.fileId] == .verified {
            return true
        }
        return FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: chapterExtension(chapter))
    }

    private func chapterExtension(_ chapter: ManifestChapter) -> String {
        let ext = URL(string: chapter.url)?.pathExtension ?? ""
        return ext.isEmpty ? "bin" : ext
    }

    private func isCurrentChapter(_ chapter: ManifestChapter) -> Bool {
        guard let editionId = audiobookEditionId else { return false }
        return model.activeEditionId == editionId && model.player.currentChapterIndex == chapter.index
    }

    private func formatDuration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(String(format: "%02dm", minutes))"
        }
        return "\(minutes)m"
    }

    private func formattedPublishedDate(_ iso: String?, year: Int?) -> String? {
        if let iso,
           let date = Self.isoDateFormatter.date(from: iso) ?? Self.isoDateNoFractionFormatter.date(from: iso)
        {
            return Self.publishedFormatter.string(from: date)
        }
        if let year {
            return String(year)
        }
        return nil
    }

    private func formattedStatus(_ status: String) -> String {
        status
            .split(separator: "_")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    private func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            return "Sign in required."
        case .http(400):
            return "This audiobook is not chapter-ready yet. Run a rescan or grab a chapterized release."
        case let .http(status):
            return "Server error (\(status))."
        case .decode:
            return "Could not parse server response."
        case .transport:
            return "Network error. Check your connection."
        }
    }

    private static let isoDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoDateNoFractionFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let publishedFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        formatter.locale = .autoupdatingCurrent
        return formatter
    }()

    private enum EbookStorageError: Error {
        case missingRemoteURL
    }
}
