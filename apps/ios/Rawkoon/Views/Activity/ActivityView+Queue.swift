import RawkoonKit
import SwiftUI

/// Queue cards, status filters, and loading.
extension ActivityView {
    // MARK: Queue

    struct QueueRow: Identifiable {
        let id: String
        let mediaId: Int
        let downloadId: Int
        let mediaTitle: String
        let releaseTitle: String
        /// Nil once the download client no longer reports the download.
        let live: LiveDownload?
        let failed: Bool
        let failReason: String?
        let postProcessError: String?

        /// Where the row goes: in flight (with its status), seeding, or nowhere.
        var section: QueueSection? {
            QueueClassifier.section(
                state: live?.state, failed: failed, failReason: failReason, postProcessError: postProcessError
            )
        }

        /// The one status and reason the card shows; nil once the download is only seeding.
        var line: QueueStatusLine? {
            guard case let .inFlight(line)? = section else { return nil }
            return line
        }
    }

    private var queueStatusCounts: [QueueStatus: Int] {
        var counts = Dictionary(grouping: inFlightRows) { $0.line?.status ?? .downloading }.mapValues(\.count)
        counts[.waiting, default: 0] += heldReleases.count
        return counts
    }

    /// Downloads in flight or failed, plus any that just finished and are still showing their check.
    private var inFlightRows: [QueueRow] {
        queueRows.filter { row in
            if case .inFlight? = row.section {
                return true
            }
            return settlingQueueIds.contains(row.id)
        }
    }

    /// Finished downloads that are only seeding, once their completion has played.
    private var seedingRows: [QueueRow] {
        queueRows.filter { $0.section == .seeding && !settlingQueueIds.contains($0.id) }
    }

    private var visibleQueueRows: [QueueRow] {
        guard let filter = queueStatusFilter else { return inFlightRows }
        return inFlightRows.filter { ($0.line?.status ?? .downloading) == filter }
    }

    private var visibleHeldReleases: [PendingRelease] {
        queueStatusFilter == nil || queueStatusFilter == .waiting ? heldReleases : []
    }

    private var queueIsEmpty: Bool {
        inFlightRows.isEmpty && heldReleases.isEmpty && seedingRows.isEmpty
    }

    var queueContent: some View {
        // A container, not a bare conditional, so the lane slide and the state swaps never share one transition.
        ZStack(alignment: .top) {
            if loadingQueue, queueIsEmpty {
                LazyVStack(spacing: 10) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        queueSkeletonCard
                    }
                }
                .padding(16)
                .transition(.rawkoonSwap)
            } else if let queueError, queueIsEmpty {
                errorView(queueError)
                    .transition(.rawkoonSwap)
            } else if queueIsEmpty {
                ContentUnavailableView(
                    "Nothing downloading",
                    systemImage: "arrow.down.circle",
                    description: Text("The queue is empty right now.")
                )
                .rawkoonLivingSymbol(.empty)
                .frame(maxWidth: .infinity, minHeight: 420)
                .transition(.rawkoonSwap)
            } else {
                VStack(spacing: 12) {
                    queueStatusBar
                    LazyVStack(spacing: 10) {
                        ForEach(visibleQueueRows) { row in
                            queueCard(row)
                                .rawkoonEntrance(id: row.id)
                                .transition(.rawkoonSwap)
                        }
                        ForEach(visibleHeldReleases) { item in
                            heldCard(item)
                                .rawkoonEntrance(id: item.id)
                                .transition(.rawkoonSwap)
                        }
                    }
                    .rawkoonEntranceScope()
                    .rawkoonMotion(RawkoonMotion.snappy, value: queueStatusFilter)
                    // A live reload that drops a finished item fades it out instead of cutting.
                    .rawkoonMotion(RawkoonMotion.spring, value: inFlightRows.map(\.id))
                    seedingSection
                }
                .padding(16)
                .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(
            queueInitialLoadResolved ? RawkoonMotion.spring : nil,
            value: Self.laneState(loading: loadingQueue, failed: queueError != nil, isEmpty: queueIsEmpty)
        )
        .onChange(of: Self.laneState(loading: loadingQueue, failed: queueError != nil, isEmpty: queueIsEmpty)) { _, current in
            if current != .loading {
                queueInitialLoadResolved = true
            }
        }
    }

    /// Finished downloads that are still seeding, out of the way until asked for.
    @ViewBuilder
    private var seedingSection: some View {
        if !seedingRows.isEmpty {
            DisclosureGroup(isExpanded: $seedingExpanded) {
                LazyVStack(spacing: 10) {
                    ForEach(seedingRows) { row in
                        queueCard(row)
                    }
                }
                .padding(.top, 10)
            } label: {
                Text("Seeding (\(seedingRows.count))")
                    .font(.system(.subheadline, design: .rounded).weight(.medium))
                    .foregroundStyle(Theme.muted)
                    .frame(minHeight: 44, alignment: .leading)
            }
            .tint(Theme.muted)
        }
    }

    /// A release held by a grab delay: it waits for a better one, or for Grab now.
    private func heldCard(_ item: PendingRelease) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: item.episodeCode.map { "\(item.mediaTitle) \u{00B7} \($0)" } ?? item.mediaTitle)
                        .font(.display(15))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    Text(verbatim: item.releaseTitle)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .lineLimit(1)
                    Text(verbatim: heldReason(item))
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                StatusBadge(text: QueueStatus.waiting.label, tint: QueueStatus.waiting.tint)
            }
            Button {
                Task { await grabHeldNow(item) }
            } label: {
                if grabbingHeldKey == item.targetKey {
                    ProgressView().tint(Theme.onAccent)
                } else {
                    Text("Grab now")
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.apricot)
            .foregroundStyle(Theme.onAccent)
            .disabled(grabbingHeldKey != nil)
            .requiresConnection(model.isOffline)
        }
        .padding(12)
        .activityCard(cornerRadius: 13)
    }

    private func heldReason(_ item: PendingRelease) -> String {
        guard let date = item.grabAfterDate, date > Date() else {
            return String(localized: "Held by a grab delay, grabbing shortly unless a better release appears")
        }
        let when = date.formatted(.relative(presentation: .named))
        return String(localized: "Held by a grab delay, grabs \(when) unless a better release appears")
    }

    private func grabHeldNow(_ item: PendingRelease) async {
        guard let client = model.api() else { return }
        grabbingHeldKey = item.targetKey
        defer { grabbingHeldKey = nil }
        do {
            let result = try await client.grabPendingNow(targetKey: item.targetKey)
            if result.grabbed {
                model.toast(String(localized: "Grabbing \(item.mediaTitle)"), style: .success)
            } else {
                model.toast(AutoGrabText.grabFailure(result.reason), style: .error)
            }
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
        await loadQueue()
    }

    /// Live status chips: a tap filters the visible cards to that status, a
    /// second tap clears it. Counts are computed from every queued row.
    private var queueStatusBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(QueueStatus.allCases, id: \.self) { status in
                    if let count = queueStatusCounts[status], count > 0 {
                        queueStatusChip(status, count: count)
                    }
                }
            }
        }
    }

    private func queueStatusChip(_ status: QueueStatus, count: Int) -> some View {
        let selected = queueStatusFilter == status
        return Button {
            queueStatusFilter = selected ? nil : status
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(status.tint)
                    .frame(width: 7, height: 7)
                Text(status.label)
                    .font(.system(.caption, design: .rounded).weight(.medium))
                Text("\(count)")
                    .font(.system(.caption, design: .monospaced))
            }
            .foregroundStyle(selected ? Theme.textStrong : Theme.muted)
            .selectableChipChrome(selected: selected, horizontalPadding: 12)
        }
        .buttonStyle(.plain)
    }

    private func queueCard(_ row: QueueRow) -> some View {
        let complete = row.live.map { DownloadMotion.isComplete(state: $0.state) } ?? false
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.mediaTitle)
                        .font(.display(15))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    Text(row.releaseTitle)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .lineLimit(1)
                    if let reason = row.line?.reason.text {
                        Text(verbatim: reason)
                            .font(.caption)
                            .foregroundStyle(row.line?.status == .failed ? Theme.danger : Theme.muted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                if complete {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Theme.seed)
                        .accessibilityHidden(true)
                        .transition(.rawkoonSwap)
                }
                // One slot keyed by the state, so a state change crossfades the badge in place.
                ZStack(alignment: .trailing) {
                    if let status = row.line?.status {
                        StatusBadge(text: status.label, tint: status.tint)
                            .id(status)
                    } else {
                        StatusBadge(text: "Seeding", tint: Theme.seed)
                            .id("seeding")
                    }
                }
            }

            if let live = row.live {
                DuskProgress(
                    value: live.progress,
                    isActive: DownloadMotion.isRunning(state: live.state, speed: live.downloadSpeed)
                )

                HStack(spacing: 10) {
                    Text("↓ \(Formatters.speed(live.downloadSpeed, useAll: true))")
                        .foregroundStyle(Theme.apricotSoft)
                        .rawkoonNumeric(live.downloadSpeed.isFinite ? live.downloadSpeed : 0)
                    Text("\(Int(live.progress * 100))%")
                        .foregroundStyle(Theme.muted)
                        .rawkoonNumeric(Double(Int(live.progress * 100)))
                    if let eta = Formatters.etaSeconds(live.etaSeconds) {
                        Text("ETA \(eta)")
                            .foregroundStyle(Theme.faint)
                            .rawkoonNumeric(Double(live.etaSeconds ?? 0))
                    }
                    Spacer()
                }
                .font(.system(.caption, design: .monospaced))
            }
        }
        .padding(12)
        .activityCard(cornerRadius: 13)
        .rawkoonMotion(RawkoonMotion.snappy, value: row.live?.state)
        // The check burst: only a finish seen on screen counts, never a card that loads already complete.
        .rawkoonCelebrate(
            trigger: complete,
            ring: .roundedRect(cornerRadius: 13),
            haptic: .downloadComplete,
            when: { !$0 && $1 }
        )
    }

    /// Warm skeleton row shown while the queue's first load is in flight.
    private var queueSkeletonCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                ShimmerView(cornerRadius: 8)
                    .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 6) {
                    ShimmerView(cornerRadius: 4).frame(height: 14)
                    ShimmerView(cornerRadius: 4).frame(width: 120, height: 11)
                }
            }
            ShimmerView(cornerRadius: 4).frame(height: 6)
        }
        .padding(12)
        .activityCard(cornerRadius: 13)
    }

    /// A title's live downloads, plus its latest failed or import-errored one the client no longer reports.
    static func queueRows(
        media list: [LibraryMedia],
        downloads: [Int: [DownloadHistoryItem]]
    ) -> [QueueRow] {
        func row(_ media: LibraryMedia, _ item: DownloadHistoryItem) -> QueueRow {
            QueueRow(
                id: "\(media.id)-\(item.id)",
                mediaId: media.id,
                downloadId: item.id,
                mediaTitle: media.title,
                releaseTitle: item.releaseTitle,
                live: item.live,
                failed: item.failed,
                failReason: item.failReason,
                postProcessError: item.postProcessError
            )
        }
        return list.flatMap { media in
            let items = downloads[media.id] ?? []
            let live = items.filter { $0.live != nil }.map { row(media, $0) }
            let problems = items.filter { item in
                item.live == nil && (item.failed || (item.postProcessError != nil && item.completedAt == nil))
            }
            let latestProblem = problems.max { $0.grabbedAt < $1.grabbedAt }
            return live + (latestProblem.map { [row(media, $0)] } ?? [])
        }
    }

    nonisolated static func cachedDownloads(client: APIClient, libraryId: Int) -> [DownloadHistoryItem] {
        let cached: Cached<DownloadsResponse>? = client.cached("/api/library/\(libraryId)/downloads")
        return cached?.value.items ?? []
    }

    func loadQueue() async {
        if !didLoadQueue {
            loadingQueue = true
        }
        queueError = nil
        defer {
            loadingQueue = false
            // A cancelled cold load showed nothing, so the next one still opens on the skeleton.
            if !Task.isCancelled {
                didLoadQueue = true
            }
        }

        guard let client = model.api() else {
            queueError = String(localized: "Not signed in.")
            return
        }

        do {
            try await apply(queueRows: Self.fetchQueueRows(client: client))
            heldReleases = await (try? client.pendingReleases()) ?? heldReleases
        } catch let error as APIError {
            queueError = message(for: error)
        } catch is CancellationError {
            // A lane switch or live reload cancelled this fetch — not a real failure.
        } catch {
            if Task.isCancelled {
                return
            }
            queueError = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }

    /// Takes a fresh list of rows. A download that just finished keeps its card for a moment, so its
    /// check and haptic play before it moves into Seeding.
    func apply(queueRows rows: [QueueRow]) {
        let inFlightBefore = Set(inFlightRows.map(\.id))
        queueRows = rows
        let finished = Set(rows.filter { $0.section == .seeding }.map(\.id)).intersection(inFlightBefore)
        guard !finished.isEmpty else { return }
        settlingQueueIds.formUnion(finished)
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            settlingQueueIds.subtract(finished)
        }
    }

    /// Every download worth showing for every downloading title; Home's Downloads card reads the same list.'s Downloads card reads the same list.
    static func fetchQueueRows(client: APIClient) async throws -> [QueueRow] {
        let list = try await client.libraryList(status: "downloading")
        // Fetch every media's downloads concurrently instead of one round-trip
        // per media; a per-media failure falls back to that media's saved
        // downloads rather than aborting the whole queue.
        let byId = try await withThrowingTaskGroup(of: (Int, [DownloadHistoryItem]).self) { group in
            for media in list.items {
                group.addTask {
                    do {
                        return try await (media.id, client.downloads(libraryId: media.id).items)
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        return (media.id, Self.cachedDownloads(client: client, libraryId: media.id))
                    }
                }
            }
            var map: [Int: [DownloadHistoryItem]] = [:]
            for try await (id, items) in group {
                map[id] = items
            }
            return map
        }
        try Task.checkCancellation()
        return queueRows(media: list.items, downloads: byId)
    }
}
