import RawkoonKit
import SwiftUI

/// Activity tab: the inbox, requests, the upcoming calendar and history. Opened on `.queue`, it is the
/// download queue on its own, pushed from Home's Pipeline card.
struct ActivityView: View {
    @Environment(AppModel.self) var model

    /// One page of history rows; the limit grows by this as the list is scrolled.
    static let historyPageSize = 50

    @State private var lane: ActivityLane
    private let isQueueScreen: Bool

    init(initialLane: ActivityLane = .inbox) {
        var lane = initialLane
        #if DEBUG
            // Screenshot harness: open a lane without tap injection, like `RAWKOON_TAB`.
            if initialLane != .queue, let raw = ProcessInfo.processInfo.environment["RAWKOON_ACTIVITY_LANE"],
               let requested = ActivityLane(rawValue: raw)
            {
                lane = requested
            }
        #endif
        _lane = State(initialValue: lane)
        isQueueScreen = initialLane == .queue
    }

    /// The side the next lane enters from, set before the lane changes so the insertion reads it fresh.
    @State private var laneEdge: Edge = .trailing
    /// In-flight live-event reload, cancelled before the next starts so a burst
    /// of SSE events can't run overlapping lane reloads.
    @State var liveReloadTask: Task<Void, Never>?
    /// In-flight "load more history" fetch, cancelled by a live reload or a
    /// filter change so a stale page can't clobber fresher rows.
    @State var loadMoreTask: Task<Void, Never>?

    /// Header speed
    @State private var speed: SpeedResponse?

    // MARK: Queue state

    @State var queueRows: [QueueRow] = []
    /// Starts true, like the other lanes, so an empty state never flashes before the first load.
    @State var loadingQueue = true
    /// The skeleton is for the cold load only; live reloads keep the current lane still.
    @State var didLoadQueue = false
    @State var queueInitialLoadResolved = false
    @State var queueError: String?
    /// Releases held by a grab delay, shown as Waiting rows with Grab now.
    @State var heldReleases: [PendingRelease] = []
    @State var grabbingHeldKey: String?
    /// Rows that finished while the lane was open, kept in place until their completion has played.
    @State var settlingQueueIds: Set<String> = []
    @State var seedingExpanded = false
    /// nil = show every card; otherwise only cards with the tapped status.
    @State var queueStatusFilter: QueueStatus?

    // History
    @State var activities: [ActivityRecord] = []
    @State var loadingHistory = true
    @State var historyInitialLoadResolved = false
    @State var loadingMoreHistory = false
    @State var historyError: String?
    @State var historyLimit = ActivityView.historyPageSize
    @State var historyHasMore = false
    @State var availableServices: [String] = []
    @State var availableTypes: [String] = []
    @State var serviceFilter: String?
    @State var typeFilter: String?

    // Calendar
    @State var upcomingItems: [UpcomingItem] = []
    @State var loadingCalendar = true
    @State var calendarInitialLoadResolved = false
    @State var calendarError: String?

    @State private var hydrated = false

    var body: some View {
        VStack(spacing: 0) {
            if !isQueueScreen {
                Picker("Lane", selection: laneSelection) {
                    ForEach(lanes, id: \.self) { lane in
                        Text(lane.title).tag(lane)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }

            if let speed, showsSpeed, lane == .queue {
                speedHeader(speed)
                    .transition(.rawkoonReveal)
            }

            // One slot, so a lane slides in over the one fading out instead of stacking under it.
            ZStack(alignment: .top) {
                laneContent
                    .id(lane)
                    .transition(.rawkoonSlide(laneEdge))
            }
        }
        .readableWidth()
        .background(Theme.base)
        .rawkoonMotion(RawkoonMotion.spring, value: showsSpeed)
        .navigationTitle(isQueueScreen ? "Queue" : "Activity")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: hydrateFromCache)
        .task { await loadSpeed() }
        .task(id: lane) { await loadCurrentLane() }
        // A deep link or an inbox action opens a lane from outside.
        .onChange(of: model.requestedActivityLane, initial: true) { _, requested in
            // Only the tab answers; a pushed queue screen must not swallow the request.
            guard let requested, !isQueueScreen else { return }
            model.requestedActivityLane = nil
            select(requested)
        }
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

    private var lanes: [ActivityLane] {
        ActivityLane.tabLanes
    }

    /// The inbox and requests are lists with their own scrolling and refresh; the other lanes share one scroll view.
    @ViewBuilder
    private var laneContent: some View {
        switch lane {
        case .inbox:
            NotificationsListView(embedded: true)
        case .requests:
            RequestsView(embedded: true)
        case .queue:
            ScrollView { queueContent }
                .reportsTabBarScroll()
                .refreshable { await loadCurrentLane() }
        case .calendar:
            ScrollView { calendarContent }
                .reportsTabBarScroll()
                .refreshable { await loadCurrentLane() }
        case .history:
            ScrollView { historyContent }
                .reportsTabBarScroll()
                .refreshable { await loadCurrentLane() }
        }
    }

    /// Picker writes go through here, so the new lane slides in from the side of the tapped segment.
    private var laneSelection: Binding<ActivityLane> {
        Binding(get: { lane }, set: { select($0) })
    }

    private func select(_ requested: ActivityLane) {
        let newLane = ActivityLane.validated(requested)
        guard newLane != lane else { return }
        laneEdge = RawkoonSlide.edge(
            from: lanes.firstIndex(of: lane) ?? 0,
            to: lanes.firstIndex(of: newLane) ?? 0
        )
        withRawkoonMotion(RawkoonMotion.snappy) { lane = newLane }
    }

    /// The header shows only while the client is connected and moving bytes.
    private var showsSpeed: Bool {
        guard let speed else { return false }
        return speed.connected && (speed.dlSpeed > 0 || speed.ulSpeed > 0)
    }

    /// Mirrors each lane's branch order, so its skeleton, error, empty and list states crossfade.
    enum LaneState: Equatable {
        case loading, failed, empty, list
    }

    static func laneState(loading: Bool, failed: Bool, isEmpty: Bool) -> LaneState {
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

    // MARK: Shared

    /// Paints every lane from the last saved responses, so Activity opens full —
    /// offline, or while the refetch is in flight.
    private func hydrateFromCache() {
        guard !hydrated, let client = model.api() else { return }
        hydrated = true
        if model.isAdmin, queueRows.isEmpty, let list = client.cached(Endpoints.libraryList(status: "downloading")) {
            let downloads = Dictionary(
                list.value.items.map { ($0.id, Self.cachedDownloads(client: client, libraryId: $0.id)) },
                uniquingKeysWith: { first, _ in first }
            )
            apply(queueRows: Self.queueRows(media: list.value.items, downloads: downloads))
        }
        if activities.isEmpty {
            paintHistoryFromCache(client: client)
        }
        if upcomingItems.isEmpty, let cached = client.cached(Endpoints.upcoming) {
            upcomingItems = cached.value.items
        }
    }

    private func loadSpeed() async {
        guard model.isAdmin, let client = model.api() else { return }
        speed = try? await client.speed()
    }

    private func loadCurrentLane() async {
        switch lane {
        case .queue: await loadQueue()
        case .history: await loadHistory()
        case .calendar: await loadCalendar()
        case .inbox, .requests: break // these lists load themselves
        }
    }

    /// Offline with nothing saved reads as a pause, not a failure.
    @ViewBuilder
    func errorView(_ text: String) -> some View {
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

    func message(for error: APIError) -> String {
        error.userMessage(unauthorized: String(localized: "Sign in required."))
    }
}

extension View {
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

extension ActivityLane {
    var title: LocalizedStringKey {
        switch self {
        case .inbox: "Inbox"
        case .queue: "Queue"
        case .requests: "Requests"
        case .calendar: "Calendar"
        case .history: "History"
        }
    }
}

extension View {
    /// A lane hosted inside Activity leaves the title to Activity; opened on its own it names itself.
    @ViewBuilder
    func standaloneTitle(_ title: LocalizedStringKey, embedded: Bool) -> some View {
        if embedded {
            self
        } else {
            navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        }
    }
}
