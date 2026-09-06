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
    /// In-flight live-event reload, cancelled before the next starts so a burst
    /// of SSE events can't run overlapping lane reloads.
    @State private var liveReloadTask: Task<Void, Never>?
    /// In-flight "load more history" fetch, cancelled by a live reload or a
    /// filter change so a stale page can't clobber fresher rows.
    @State private var loadMoreTask: Task<Void, Never>?

    /// Header speed
    @State private var speed: SpeedResponse?

    // Queue
    @State private var queueRows: [QueueRow] = []
    @State private var loadingQueue = false
    @State private var queueError: String?
    /// nil = show every card; otherwise only cards in the tapped phase.
    @State private var queuePhaseFilter: QueuePhase?

    // History
    @State private var activities: [ActivityRecord] = []
    @State private var loadingHistory = false
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
    @State private var loadingCalendar = false
    @State private var calendarError: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Lane", selection: $lane) {
                ForEach(Lane.allCases) { lane in
                    Text(lane.title).tag(lane)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if let speed, speed.connected, speed.dlSpeed > 0 || speed.ulSpeed > 0 {
                speedHeader(speed)
            }

            ScrollView {
                switch lane {
                case .queue: queueContent
                case .history: historyContent
                case .calendar: calendarContent
                }
            }
        }
        .background(Theme.base)
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadSpeed() }
        .task(id: lane) { await loadCurrentLane() }
        .refreshable { await loadCurrentLane() }
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

    @ViewBuilder
    private var queueContent: some View {
        if loadingQueue, queueRows.isEmpty {
            LazyVStack(spacing: 10) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    queueSkeletonCard
                }
            }
            .padding(16)
        } else if let queueError {
            errorView(queueError)
        } else if queueRows.isEmpty {
            ContentUnavailableView(
                "Nothing downloading",
                systemImage: "arrow.down.circle",
                description: Text("The queue is empty right now.")
            )
            .foregroundStyle(Theme.faint)
            .frame(maxWidth: .infinity, minHeight: 420)
        } else {
            VStack(spacing: 12) {
                queuePhaseBar
                LazyVStack(spacing: 10) {
                    ForEach(visibleQueueRows) { row in
                        queueCard(row)
                    }
                }
                .rawkoonMotion(RawkoonMotion.snappy, value: queuePhaseFilter)
            }
            .padding(16)
        }
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
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(selected ? Theme.raised : Theme.well, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Theme.borderStrong : Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func queueCard(_ row: QueueRow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
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
                statusBadge(row.live.state, tint: stateTint(row.live.state))
            }

            DuskProgress(value: row.live.progress)

            HStack(spacing: 10) {
                Text("↓ \(Formatters.speed(row.live.downloadSpeed, useAll: true))")
                    .foregroundStyle(Theme.apricotSoft)
                Text("\(Int(row.live.progress * 100))%")
                    .foregroundStyle(Theme.muted)
                if let eta = row.live.etaSeconds {
                    Text("ETA \(formatETA(eta))")
                        .foregroundStyle(Theme.faint)
                }
                Spacer()
            }
            .font(.system(.caption, design: .monospaced))
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.border, lineWidth: 1))
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
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.border, lineWidth: 1))
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

    private func formatETA(_ seconds: Int) -> String {
        let minutes = seconds / 60
        if minutes >= 60 {
            return "\(minutes / 60)h \(minutes % 60)m"
        }
        return "\(minutes)m"
    }

    private func loadQueue() async {
        loadingQueue = true
        queueError = nil
        defer { loadingQueue = false }

        guard let client = model.api() else {
            queueError = String(localized: "Not signed in.")
            return
        }

        do {
            let list = try await client.libraryList(status: "downloading")
            // Fetch every media's downloads concurrently instead of one round-trip
            // per media; a per-media failure yields an empty list rather than
            // aborting the whole queue.
            let byId = try await withThrowingTaskGroup(of: (Int, [DownloadHistoryItem]).self) { group in
                for media in list.items {
                    group.addTask {
                        await (media.id, (try? client.downloads(libraryId: media.id))?.items ?? [])
                    }
                }
                var map: [Int: [DownloadHistoryItem]] = [:]
                for try await (id, items) in group {
                    map[id] = items
                }
                return map
            }
            var rows: [QueueRow] = []
            for media in list.items {
                for item in byId[media.id] ?? [] {
                    guard let live = item.live else { continue }
                    rows.append(
                        QueueRow(
                            id: "\(media.id)-\(item.id)",
                            mediaTitle: media.title,
                            releaseTitle: item.releaseTitle,
                            live: live
                        )
                    )
                }
            }
            queueRows = rows
        } catch let error as APIError {
            queueError = message(for: error)
        } catch is CancellationError {
            // A lane switch or live reload cancelled this fetch — not a real failure.
        } catch {
            if Task.isCancelled {
                return
            }
            queueError = String(localized: "Network error. Check your connection.")
        }
    }

    // MARK: History

    @ViewBuilder
    private var historyContent: some View {
        VStack(spacing: 12) {
            historyFilterBar

            if loadingHistory, activities.isEmpty {
                historySkeleton
            } else if let historyError {
                errorView(historyError)
            } else if activities.isEmpty {
                ContentUnavailableView(
                    "No recent activity",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Nothing has happened yet.")
                )
                .foregroundStyle(Theme.faint)
                .frame(maxWidth: .infinity, minHeight: 360)
            } else {
                historyList
            }
        }
        .padding(16)
    }

    private var historyList: some View {
        LazyVStack(spacing: 8) {
            ForEach(Array(activities.enumerated()), id: \.offset) { _, activity in
                historyRow(activity)
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
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
    }

    private func metaPill(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .rounded).weight(.medium))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.14), in: Capsule())
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
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(selected ? Theme.raised : Theme.well, in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? Theme.borderStrong : Theme.border, lineWidth: 1))
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
        liveReloadTask?.cancel()
        loadMoreTask?.cancel()
        liveReloadTask = Task { await loadHistory() }
    }

    private func loadHistory() async {
        guard let client = model.api() else {
            historyError = String(localized: "Not signed in.")
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
            activities = feed.activities
            historyHasMore = feed.hasMore == true
            if let services = feed.availableServices {
                availableServices = services
            }
            if let types = feed.availableTypes {
                availableTypes = types
            }
        } catch let error as APIError {
            historyError = message(for: error)
        } catch {
            historyError = String(localized: "Network error. Check your connection.")
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
            activities = feed.activities
            historyHasMore = feed.hasMore == true
            if let services = feed.availableServices {
                availableServices = services
            }
            if let types = feed.availableTypes {
                availableTypes = types
            }
        } catch {
            // Keep the rows already on screen if a page fails to load.
        }
    }

    // MARK: Calendar

    @ViewBuilder
    private var calendarContent: some View {
        if loadingCalendar {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity, minHeight: 420)
        } else if let calendarError {
            errorView(calendarError)
        } else if upcomingItems.isEmpty {
            ContentUnavailableView(
                "Nothing upcoming",
                systemImage: "calendar",
                description: Text("No known releases on the horizon.")
            )
            .foregroundStyle(Theme.faint)
            .frame(maxWidth: .infinity, minHeight: 420)
        } else {
            LazyVStack(spacing: 8) {
                ForEach(upcomingItems) { item in
                    calendarRow(item)
                }
            }
            .padding(16)
        }
    }

    private func calendarRow(_ item: UpcomingItem) -> some View {
        HStack(spacing: 12) {
            BookCover(url: model.absoluteURL(item.posterUrl), size: 48, corner: 8)

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
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
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
            calendarError = String(localized: "Network error. Check your connection.")
        }
    }

    // MARK: Shared

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

    private func errorView(_ text: String) -> some View {
        ContentUnavailableView(
            "Something went wrong",
            systemImage: "exclamationmark.triangle",
            description: Text(text)
        )
        .foregroundStyle(Theme.faint)
        .frame(maxWidth: .infinity, minHeight: 420)
    }

    private func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}
