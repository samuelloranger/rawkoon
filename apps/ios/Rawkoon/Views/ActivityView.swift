import RawkoonKit
import SwiftUI

/// Tab root: download queue, recent history, and the upcoming calendar.
struct ActivityView: View {
    @Environment(AppModel.self) private var model

    private enum Lane: String, CaseIterable, Identifiable {
        case queue = "Queue"
        case history = "History"
        case calendar = "Calendar"
        var id: String {
            rawValue
        }

        var title: LocalizedStringKey {
            switch self {
            case .queue: "Queue"
            case .history: "History"
            case .calendar: "Calendar"
            }
        }
    }

    /// One page of history rows; the limit grows by this as the list is scrolled.
    private static let historyPageSize = 50

    @State private var lane: Lane = .queue
    /// The side the next lane enters from, set before the lane changes so the insertion reads it fresh.
    @State private var laneEdge: Edge = .trailing
    /// In-flight live-event reload, cancelled before the next starts so a burst
    /// of SSE events can't run overlapping lane reloads.
    @State private var liveReloadTask: Task<Void, Never>?
    /// In-flight "load more history" fetch, cancelled by a live reload or a
    /// filter change so a stale page can't clobber fresher rows.
    @State private var loadMoreTask: Task<Void, Never>?

    /// Header speed
    @State private var speed: SpeedResponse?

    // MARK: Queue state
    @State private var queueRows: [QueueRow] = []
    /// Starts true, like the other lanes, so an empty state never flashes before the first load.
    @State private var loadingQueue = true
    /// The skeleton is for the cold load only; live reloads keep the current lane still.
    @State private var didLoadQueue = false
    @State private var queueError: String?
    /// nil = show every card; otherwise only cards in the tapped phase.
    @State private var queuePhaseFilter: QueuePhase?

    // History
    @State private var activities: [ActivityRecord] = []
    @State private var loadingHistory = true
    @State private var loadingMoreHistory = false
    @State private var historyError: String?
    @State private var historyLimit = ActivityView.historyPageSize
    @State private var historyHasMore = false
    @State private var availableServices: [String] = []
    @State private var availableTypes: [String] = []
    @State private var serviceFilter: String?
    @State private var typeFilter: String?

    // Calendar
    @State private var upcomingItems: [UpcomingItem] = []
    @State private var loadingCalendar = true
    @State private var calendarError: String?

    @State private var hydrated = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Lane", selection: laneSelection) {
                ForEach(Lane.allCases) { lane in
                    Text(lane.title).tag(lane)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if let speed, showsSpeed {
                speedHeader(speed)
                    .transition(.rawkoonReveal)
            }

            ScrollView {
                // One slot, so a lane slides in over the one fading out instead of stacking under it.
                ZStack(alignment: .top) {
                    switch lane {
                    case .queue:
                        queueContent
                            .transition(.rawkoonSlide(laneEdge))
                    case .history:
                        historyContent
                            .transition(.rawkoonSlide(laneEdge))
                    case .calendar:
                        calendarContent
                            .transition(.rawkoonSlide(laneEdge))
                    }
                }
            }
        }
        .readableWidth()
        .background(Theme.base)
        .rawkoonMotion(RawkoonMotion.spring, value: showsSpeed)
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: hydrateFromCache)
        .task { await loadSpeed() }
        .task(id: lane) { await loadCurrentLane() }
        .refreshable { await loadCurrentLane() }
        .onChange(of: model.isOffline) { _, offline in
            guard !offline else { return }
            liveReloadTask?.cancel()
            loadMoreTask?.cancel()
            liveReloadTask = Task { await loadCurrentLane() }
        }
        .onChange(of: model.libraryChangeToken) { _, _ in
            liveReloadTask?.cancel()
            loadMoreTask?.cancel()
            liveReloadTask = Task { await loadCurrentLane() }
        }
        .onChange(of: model.bookChangeToken) { _, _ in
            liveReloadTask?.cancel()
            loadMoreTask?.cancel()
            liveReloadTask = Task { await loadCurrentLane() }
        }
    }

    /// Picker writes go through here, so the new lane slides in from the side of the tapped segment.
    private var laneSelection: Binding<Lane> {
        Binding(
            get: { lane },
            set: { newLane in
                laneEdge = RawkoonSlide.edge(
                    from: Lane.allCases.firstIndex(of: lane) ?? 0,
                    to: Lane.allCases.firstIndex(of: newLane) ?? 0
                )
                withRawkoonMotion(RawkoonMotion.snappy) { lane = newLane }
            }
        )
    }

    /// The header shows only while the client is connected and moving bytes.
    private var showsSpeed: Bool {
        guard let speed else { return false }
        return speed.connected && (speed.dlSpeed > 0 || speed.ulSpeed > 0)
    }

    /// Mirrors each lane's branch order, so its skeleton, error, empty and list states crossfade.
    private enum LaneState: Equatable {
        case loading, failed, empty, list
    }

    private static func laneState(loading: Bool, failed: Bool, isEmpty: Bool) -> LaneState {
        guard isEmpty else { return .list }
        if loading {
            return .loading
        }
        return failed ? .failed : .empty
    }

    // MARK: Header

    private func speedHeader(_ speed: SpeedResponse) -> some View {
        HStack(spacing: 14) {
            Label(Formatters.speed(speed.dlSpeed, useAll: true), systemImage: "arrow.down")
            Label(Formatters.speed(speed.ulSpeed, useAll: true), systemImage: "arrow.up")
            Spacer()
        }
        .font(.system(.caption, design: .monospaced))
        .foregroundStyle(Theme.faint)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: Queue

    private struct QueueRow: Identifiable {
        let id: String
        let mediaTitle: String
        let releaseTitle: String
        let live: LiveDownload
    }

    /// The three live phases a queued download can be in. Derived locally from
    /// `LiveDownload.state` so the counts stay in sync with the visible cards.
    private enum QueuePhase: String, CaseIterable, Identifiable {
        case downloading, importing, seeding
        var id: String {
            rawValue
        }

        var label: LocalizedStringKey {
            switch self {
            case .downloading: "Downloading"
            case .importing: "Importing"
            case .seeding: "Seeding"
            }
        }

        var tint: Color {
            switch self {
            case .downloading: Theme.terracotta
            case .importing: Theme.importing
            case .seeding: Theme.seed
            }
        }
    }

    private func phase(of state: String) -> QueuePhase {
        let lower = state.lowercased()
        if lower.contains("seed") || lower.contains("complete") {
            return .seeding
        }
        if lower.contains("import") || lower.contains("process") {
            return .importing
        }
        return .downloading
    }

    private var queuePhaseCounts: [QueuePhase: Int] {
        Dictionary(grouping: queueRows) { phase(of: $0.live.state) }.mapValues(\.count)
    }

    private var visibleQueueRows: [QueueRow] {
        guard let filter = queuePhaseFilter else { return queueRows }
        return queueRows.filter { phase(of: $0.live.state) == filter }
    }

    private var queueContent: some View {
        // A container, not a bare conditional, so the lane slide and the state swaps never share one transition.
        ZStack(alignment: .top) {
            if loadingQueue, queueRows.isEmpty {
                LazyVStack(spacing: 10) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        queueSkeletonCard
                    }
                }
                .padding(16)
                .transition(.rawkoonSwap)
            } else if let queueError, queueRows.isEmpty {
                errorView(queueError)
                    .transition(.rawkoonSwap)
            } else if queueRows.isEmpty {
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
                    queuePhaseBar
                    LazyVStack(spacing: 10) {
                        ForEach(visibleQueueRows) { row in
                            queueCard(row)
                                .rawkoonEntrance(id: row.id)
                                .transition(.rawkoonSwap)
                        }
                    }
                    .rawkoonEntranceScope()
                    .rawkoonMotion(RawkoonMotion.snappy, value: queuePhaseFilter)
                    // A live reload that drops a finished item fades it out instead of cutting.
                    .rawkoonMotion(RawkoonMotion.spring, value: queueRows.map(\.id))
                }
                .padding(16)
                .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(
            RawkoonMotion.spring,
            value: Self.laneState(loading: loadingQueue, failed: queueError != nil, isEmpty: queueRows.isEmpty)
        )
    }

    /// Live status chips: a tap filters the visible cards to that phase, a
    /// second tap clears it. Counts are computed from every queued row.
    private var queuePhaseBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(QueuePhase.allCases) { phase in
                    if let count = queuePhaseCounts[phase], count > 0 {
                        queuePhaseChip(phase, count: count)
                    }
                }
            }
        }
    }

    private func queuePhaseChip(_ phase: QueuePhase, count: Int) -> some View {
        let selected = queuePhaseFilter == phase
        return Button {
            queuePhaseFilter = selected ? nil : phase
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(phase.tint)
                    .frame(width: 7, height: 7)
                Text(phase.label)
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
        let complete = DownloadMotion.isComplete(state: row.live.state)
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
                    statusBadge(row.live.state, tint: stateTint(row.live.state))
                        .id(row.live.state)
                }
            }

            DuskProgress(value: row.live.progress, isActive: DownloadMotion.isRunning(state: row.live.state, speed: row.live.downloadSpeed))

            HStack(spacing: 10) {
                Text("↓ \(Formatters.speed(row.live.downloadSpeed, useAll: true))")
                    .foregroundStyle(Theme.apricotSoft)
                    .rawkoonNumeric(row.live.downloadSpeed.isFinite ? row.live.downloadSpeed : 0)
                Text("\(Int(row.live.progress * 100))%")
                    .foregroundStyle(Theme.muted)
                    .rawkoonNumeric(Double(Int(row.live.progress * 100)))
                if let eta = Formatters.etaSeconds(row.live.etaSeconds) {
                    Text("ETA \(eta)")
                        .foregroundStyle(Theme.faint)
                        .rawkoonNumeric(Double(row.live.etaSeconds ?? 0))
                }
                Spacer()
            }
            .font(.system(.caption, design: .monospaced))
        }
        .padding(12)
        .activityCard(cornerRadius: 13)
        .rawkoonMotion(RawkoonMotion.snappy, value: row.live.state)
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

    private func stateTint(_ state: String) -> Color {
        let lower = state.lowercased()
        if lower.contains("seed") || lower.contains("complete") {
            return Theme.seed
        }
        if lower.contains("import") || lower.contains("process") {
            return Theme.importing
        }
        if lower.contains("download") {
            return Theme.importing
        }
        return Theme.muted
    }

    private static func queueRows(
        media list: [LibraryMedia],
        downloads: [Int: [DownloadHistoryItem]]
    ) -> [QueueRow] {
        list.flatMap { media in
            (downloads[media.id] ?? []).compactMap { item in
                item.live.map { live in
                    QueueRow(
                        id: "\(media.id)-\(item.id)",
                        mediaTitle: media.title,
                        releaseTitle: item.releaseTitle,
                        live: live
                    )
                }
            }
        }
    }

    private nonisolated static func cachedDownloads(client: APIClient, libraryId: Int) -> [DownloadHistoryItem] {
        let cached: Cached<DownloadsResponse>? = client.cached("/api/library/\(libraryId)/downloads")
        return cached?.value.items ?? []
    }

    private func loadQueue() async {
        if !didLoadQueue {
            loadingQueue = true
        }
        queueError = nil
        defer {
            loadingQueue = false
            didLoadQueue = true
        }

        guard let client = model.api() else {
            queueError = String(localized: "Not signed in.")
            return
        }

        do {
            let list = try await client.libraryList(status: "downloading")
            // Fetch every media's downloads concurrently instead of one round-trip
            // per media; a per-media failure falls back to that media's saved
            // downloads rather than aborting the whole queue.
            let byId = try await withThrowingTaskGroup(of: (Int, [DownloadHistoryItem]).self) { group in
                for media in list.items {
                    group.addTask {
                        do {
                            return try await (media.id, client.downloads(libraryId: media.id).items)
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
            queueRows = Self.queueRows(media: list.items, downloads: byId)
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

    // MARK: History

    private var historyContent: some View {
        VStack(spacing: 12) {
            historyFilterBar

            // One slot, so the outgoing state never stacks above the incoming one.
            ZStack(alignment: .top) {
                if loadingHistory, activities.isEmpty {
                    historySkeleton
                        .transition(.rawkoonSwap)
                } else if let historyError, activities.isEmpty {
                    errorView(historyError)
                        .transition(.rawkoonSwap)
                } else if activities.isEmpty {
                    ContentUnavailableView(
                        "No recent activity",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("Nothing has happened yet.")
                    )
                    .rawkoonLivingSymbol(.empty)
                    .frame(maxWidth: .infinity, minHeight: 360)
                    .transition(.rawkoonSwap)
                } else {
                    historyList
                        .transition(.rawkoonSwap)
                }
            }
            .rawkoonMotion(
                RawkoonMotion.spring,
                value: Self.laneState(loading: loadingHistory, failed: historyError != nil, isEmpty: activities.isEmpty)
            )
        }
        .padding(16)
    }

    private var historyList: some View {
        LazyVStack(spacing: 8) {
            ForEach(Array(activities.enumerated()), id: \.offset) { offset, activity in
                historyRow(activity)
                    .rawkoonEntrance(id: activity.id ?? -(offset + 1))
                    .onAppear {
                        // Trigger on the row's own identity, not its offset: an
                        // offset-keyed ForEach re-fires `onAppear` for whichever
                        // row currently sits at the "last" offset, which with
                        // SwiftUI's double-fire could cancel a load that's
                        // already in flight and stall pagination.
                        guard historyHasMore, !loadingMoreHistory, loadMoreTask == nil,
                              let id = activity.id, id == activities.last?.id
                        else { return }
                        loadMoreTask = Task {
                            await loadMoreHistory()
                            loadMoreTask = nil
                        }
                    }
            }
            if loadingMoreHistory {
                historySkeletonRow
            }
        }
        .rawkoonEntranceScope()
        .rawkoonMotion(RawkoonMotion.gentle, value: activities.count)
    }

    private func historyRow(_ activity: ActivityRecord) -> some View {
        let presentation = ActivityPresentation.make(for: activity)
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: presentation.symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(presentation.tint)
                .frame(width: 36, height: 36)
                .background(presentation.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 6) {
                Text(presentation.description)
                    .font(.subheadline)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    metaPill(presentation.serviceLabel, tint: presentation.tint)
                    metaPill(presentation.typeLabel, tint: Theme.muted)
                    Spacer(minLength: 0)
                    if !presentation.time.isEmpty {
                        Text(presentation.time)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Theme.faint)
                    }
                }
            }
        }
        .padding(12)
        .activityCard(cornerRadius: 12)
    }

    private func metaPill(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .rounded).weight(.medium))
            .foregroundStyle(tint)
            .chipCapsule(tint: tint)
    }

    // MARK: History filters

    @ViewBuilder
    private var historyFilterBar: some View {
        if !availableServices.isEmpty || !availableTypes.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                if !availableServices.isEmpty {
                    filterRow(
                        title: "Service",
                        options: availableServices,
                        selected: serviceFilter,
                        label: { ActivityPresentation.serviceLabel(for: $0) }
                    ) { option in
                        serviceFilter = serviceFilter == option ? nil : option
                        applyHistoryFilter()
                    }
                }
                if !availableTypes.isEmpty {
                    filterRow(
                        title: "Type",
                        options: availableTypes,
                        selected: typeFilter,
                        label: { ActivityPresentation.typeLabel(for: $0) }
                    ) { option in
                        typeFilter = typeFilter == option ? nil : option
                        applyHistoryFilter()
                    }
                }
            }
        }
    }

    private func filterRow(
        title: LocalizedStringKey,
        options: [String],
        selected: String?,
        label: @escaping (String) -> String,
        onTap: @escaping (String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .padding(.leading, 2)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(options, id: \.self) { option in
                        filterChip(label(option), selected: selected == option) {
                            onTap(option)
                        }
                    }
                }
            }
        }
    }

    private func filterChip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(.caption, design: .rounded).weight(.medium))
                .foregroundStyle(selected ? Theme.textStrong : Theme.faint)
                .selectableChipChrome(selected: selected, horizontalPadding: 14)
        }
        .buttonStyle(.plain)
    }

    private var historySkeleton: some View {
        LazyVStack(spacing: 8) {
            ForEach(0 ..< 6, id: \.self) { _ in
                historySkeletonRow
            }
        }
    }

    private var historySkeletonRow: some View {
        HStack(alignment: .top, spacing: 12) {
            ShimmerView(cornerRadius: 10)
                .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 6) {
                ShimmerView(cornerRadius: 4).frame(height: 13)
                ShimmerView(cornerRadius: 4).frame(width: 140, height: 10)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
    }

    /// A filter tap resets the window to one page and reloads, reusing the
    /// live-reload task slot so it cancels any in-flight reload cleanly.
    private func applyHistoryFilter() {
        historyLimit = Self.historyPageSize
        if let client = model.api() {
            paintHistoryFromCache(client: client)
        }
        liveReloadTask?.cancel()
        loadMoreTask?.cancel()
        liveReloadTask = Task { await loadHistory() }
    }

    private func loadHistory() async {
        guard let client = model.api() else {
            historyError = String(localized: "Not signed in.")
            loadingHistory = false
            return
        }
        // Skeleton only on a cold load; a live reload keeps the current rows.
        if activities.isEmpty {
            loadingHistory = true
        }
        historyError = nil
        defer { loadingHistory = false }

        do {
            let feed = try await client.activityFeed(
                limit: historyLimit, service: serviceFilter, type: typeFilter
            )
            if Task.isCancelled {
                return
            }
            applyFeed(feed)
        } catch let error as APIError {
            historyError = message(for: error)
        } catch {
            historyError = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }

    private func applyFeed(_ feed: ActivityFeedResponse) {
        activities = feed.activities
        historyHasMore = feed.hasMore == true
        if let services = feed.availableServices {
            availableServices = services
        }
        if let types = feed.availableTypes {
            availableTypes = types
        }
    }

    /// Swaps in the saved feed for the current filters. Offline with nothing
    /// saved, the rows are cleared so another filter's rows don't pose as these.
    private func paintHistoryFromCache(client: APIClient) {
        let endpoint = Endpoints.activityFeed(limit: historyLimit, service: serviceFilter, type: typeFilter)
        if let cached = client.cached(endpoint) {
            applyFeed(cached.value)
        } else if model.isOffline {
            activities = []
            historyHasMore = false
        }
    }

    private func loadMoreHistory() async {
        guard historyHasMore, !loadingMoreHistory, !loadingHistory else { return }
        guard let client = model.api() else { return }
        loadingMoreHistory = true
        defer { loadingMoreHistory = false }

        let nextLimit = historyLimit + Self.historyPageSize
        do {
            let feed = try await client.activityFeed(
                limit: nextLimit, service: serviceFilter, type: typeFilter
            )
            if Task.isCancelled {
                return
            }
            historyLimit = nextLimit
            applyFeed(feed)
        } catch {
            // Keep the rows already on screen if a page fails to load.
        }
    }

    // MARK: Calendar

    private var calendarContent: some View {
        // A container, not a bare conditional, so the lane slide and the state swaps never share one transition.
        ZStack(alignment: .top) {
            if loadingCalendar, upcomingItems.isEmpty {
                ProgressView().tint(Theme.apricot)
                    .frame(maxWidth: .infinity, minHeight: 420)
                    .transition(.rawkoonSwap)
            } else if let calendarError, upcomingItems.isEmpty {
                errorView(calendarError)
                    .transition(.rawkoonSwap)
            } else if upcomingItems.isEmpty {
                ContentUnavailableView(
                    "Nothing upcoming",
                    systemImage: "calendar",
                    description: Text("No known releases on the horizon.")
                )
                .rawkoonLivingSymbol(.empty)
                .frame(maxWidth: .infinity, minHeight: 420)
                .transition(.rawkoonSwap)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(upcomingItems) { item in
                        calendarRow(item)
                            .rawkoonEntrance(id: item.id)
                    }
                }
                .padding(16)
                .rawkoonEntranceScope()
                .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(
            RawkoonMotion.spring,
            value: Self.laneState(
                loading: loadingCalendar, failed: calendarError != nil, isEmpty: upcomingItems.isEmpty
            )
        )
    }

    private func calendarRow(_ item: UpcomingItem) -> some View {
        HStack(spacing: 12) {
            MediaThumb(url: model.absoluteURL(item.posterUrl), width: 48)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.display(15))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    if let releaseDate = item.releaseDate, !releaseDate.isEmpty {
                        Text(releaseDate)
                    }
                    if let season = item.seasonNumber {
                        if let episode = item.episodeNumber {
                            Text(String(format: "S%02dE%02d", season, episode))
                        } else {
                            Text(String(format: "S%02d", season))
                        }
                    }
                }
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .activityCard(cornerRadius: 12)
    }

    private func loadCalendar() async {
        loadingCalendar = true
        calendarError = nil
        defer { loadingCalendar = false }

        guard let client = model.api() else {
            calendarError = String(localized: "Not signed in.")
            return
        }

        do {
            let response = try await client.upcoming()
            upcomingItems = response.items
        } catch let error as APIError {
            calendarError = message(for: error)
        } catch {
            calendarError = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }

    // MARK: Shared

    /// Paints every lane from the last saved responses, so Activity opens full —
    /// offline, or while the refetch is in flight.
    private func hydrateFromCache() {
        guard !hydrated, let client = model.api() else { return }
        hydrated = true
        if queueRows.isEmpty, let list = client.cached(Endpoints.libraryList(status: "downloading")) {
            let downloads = Dictionary(
                list.value.items.map { ($0.id, Self.cachedDownloads(client: client, libraryId: $0.id)) },
                uniquingKeysWith: { first, _ in first }
            )
            queueRows = Self.queueRows(media: list.value.items, downloads: downloads)
        }
        if activities.isEmpty {
            paintHistoryFromCache(client: client)
        }
        if upcomingItems.isEmpty, let cached = client.cached(Endpoints.upcoming) {
            upcomingItems = cached.value.items
        }
    }

    private func loadSpeed() async {
        guard let client = model.api() else { return }
        speed = try? await client.speed()
    }

    private func loadCurrentLane() async {
        switch lane {
        case .queue: await loadQueue()
        case .history: await loadHistory()
        case .calendar: await loadCalendar()
        }
    }

    /// Offline with nothing saved reads as a pause, not a failure.
    @ViewBuilder
    private func errorView(_ text: String) -> some View {
        if model.isOffline {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, minHeight: 420)
        } else {
            ContentUnavailableView(
                "Something went wrong",
                systemImage: "exclamationmark.triangle",
                description: Text(text)
            )
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, minHeight: 420)
        }
    }

    private func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}

private extension View {
    /// Shared lane-card chrome: raised fill + a hairline border, so queue,
    /// history and calendar cards read as the same surface.
    func activityCard(cornerRadius: CGFloat) -> some View {
        background(Theme.raised, in: RoundedRectangle(cornerRadius: cornerRadius))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).strokeBorder(Theme.border, lineWidth: 1))
    }

    /// Shared selectable-chip chrome (raised when on, well when off) for the
    /// queue-phase and history-filter chips, which were near-identical.
    func selectableChipChrome(selected: Bool, horizontalPadding: CGFloat) -> some View {
        padding(.horizontal, horizontalPadding)
            .frame(minHeight: 44)
            .background(selected ? Theme.raised : Theme.well, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Theme.borderStrong : Theme.border, lineWidth: 1))
    }
}
