import Foundation
import RawkoonKit
import SwiftUI

struct BookAudiobookView: View {
    let page: BookView
    let audioState: BookAudiobookState
    @Binding var showingPlayer: Bool
    @Binding var chapterFilter: String
    /// Bumped by the download-state notification so the buttons re-evaluate even when Observation misses it.
    @State private var downloadRefreshTick = 0
    @State private var stateProbe = DownloadStateProbe()
    /// Longer than one screen of spine rows; a 3-chapter book does not need a field.
    private let chapterFilterThreshold = 12

    var body: some View {
        audiobookSection
    }

    private var model: AppModel {
        page.model
    }

    private var book: BookListItem {
        page.book
    }

    private var audiobookEdition: BookEditionDetail? {
        page.audiobookEdition
    }

    private var audiobookEditionId: Int? {
        page.audiobookEditionId
    }

    private var hasAudiobookEdition: Bool {
        page.hasAudiobookEdition
    }

    private var manifest: BookManifest? {
        page.manifest
    }

    private var loadingManifest: Bool {
        page.loadingManifest
    }

    private var fetchAttemptedManifest: Bool {
        page.fetchAttemptedManifest
    }

    private var manifestError: String? {
        page.manifestError
    }

    private var audiobookResume: AudiobookResumeLabel {
        page.audiobookResume
    }

    private var canPlayAudiobook: Bool {
        page.canPlayAudiobook
    }

    @ViewBuilder
    var audiobookSection: some View {
        if hasAudiobookEdition {
            VStack(alignment: .leading, spacing: 14) {
                page.metricsCard(
                    title: "Audiobook",
                    status: audiobookEdition?.status ?? book.audiobookStatus ?? "wanted",
                    accent: Theme.muted,
                    metrics: audiobookMetrics
                )
                audiobookActionButtons
                chaptersList
                page.bookManagementCard(lane: .audiobook)
            }
        } else {
            page.missingEditionCard(
                title: "Audiobook edition missing",
                description: "Add an audiobook edition, then search releases to play and download chapters offline.",
                buttonTitle: "Add audiobook",
                tint: Theme.terracotta,
                action: { Task { await page.addEdition(kind: "audiobook") } }
            )
        }
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

            if let audiobookActionError = audioState.audiobookActionError {
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
        withRawkoonMotion(.spring(duration: 0.35)) { audioState.showDownloadFinished = true }
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            withRawkoonMotion(.easeOut(duration: 0.3)) { audioState.showDownloadFinished = false }
        }
    }

    var audiobookPlayButton: some View {
        Button {
            Task {
                guard let editionId = audiobookEditionId else { return }
                audioState.audiobookActionError = nil
                audioState.loadingPlayer = true
                // "Play" has to mean from the start — but only once the
                // preview has loaded. Before that the label is a placeholder,
                // so the player resolves the position itself.
                let previewed = model.resumePreview[editionId] != nil
                let resumeAt: Double? = (previewed && audiobookResume == .play) ? 0 : nil
                await model.openPlayer(editionId: editionId, resumeAt: resumeAt)
                audioState.loadingPlayer = false
                if let error = model.errorMessage {
                    audioState.audiobookActionError = error
                } else {
                    showingPlayer = true
                }
            }
        } label: {
            Group {
                if audioState.loadingPlayer {
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
        let hasDownloader = audiobookEditionId.map { model.downloaders[$0] != nil } == true
        if plan == nil, audioState.preparingAudiobookDownload || hasDownloader {
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
            DownloadStateIcon(state: state, celebrating: audioState.showDownloadFinished)
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
                audioState.audiobookActionError = nil
                audioState.preparingAudiobookDownload = true
                await model.startDownload(editionId: editionId)
                audioState.preparingAudiobookDownload = false
                if let error = model.errorMessage {
                    audioState.audiobookActionError = error
                }
            }
        case .preparing:
            break
        case .downloading:
            audioState.audiobookActionError = nil
            audioState.preparingAudiobookDownload = false
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
                                    audioState.loadingPlayer = true
                                    await model.openPlayer(
                                        editionId: editionId,
                                        resumeAt: page.resumePosition(in: chapter) ?? chapter.startSecs
                                    )
                                    audioState.loadingPlayer = false
                                    if model.errorMessage == nil {
                                        showingPlayer = true
                                    }
                                }
                            } label: {
                                SpineRow(
                                    index: chapter.index,
                                    title: chapter.title,
                                    downloaded: page.isChapterDownloaded(chapter),
                                    current: page.isCurrentChapter(chapter),
                                    downloadFraction: audiobookEditionId.flatMap {
                                        model.chapterFractions[$0]?[chapter.fileId]
                                    },
                                    resumeText: page.resumePosition(in: chapter).map {
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
}
