import RawkoonKit
import SwiftUI

/// The Inbox lane of Activity: a paginated, infinite-scroll list with
/// mark-all-as-read and per-row mark-read/delete. Each row and the live banner
/// (`NotificationBannerView`) resolve their tap through `AppModel.navigate(toNotificationUrl:)`;
/// a few rows also act in place (see `InboxAction`).
struct NotificationsListView: View {
    @Environment(AppModel.self) private var model

    /// True inside the Activity tab, which owns the navigation title.
    var embedded = false

    @State private var notifications: [NotificationDTO] = []
    @State private var page = 1
    @State private var hasMore = false
    @State private var loading = true
    @State private var initialLoadResolved = false
    @State private var loadingMore = false
    @State private var errorMessage: String?
    @State private var pendingDeleteId: Int?
    @State private var markingAllAsRead = false
    /// Rows whose Search again is running, so a second tap can't start a second search.
    @State private var searchingIds: Set<Int> = []

    private let limit = 25

    var body: some View {
        content
            .readableWidth(860)
            .background(Theme.base)
            .standaloneTitle("Notifications", embedded: embedded)
            .toolbar {
                if !notifications.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Mark all read") {
                            Task { await markAllAsRead() }
                        }
                        .disabled(markingAllAsRead || !notifications.contains { !$0.read })
                        .requiresConnection(model.isOffline)
                    }
                }
            }
            .onAppear(perform: hydrateFromCache)
            // Keyed on the live token so a notification arriving while the list
            // is open refetches it (and cancels an in-flight load), instead of
            // only the bell badge updating while the list stays stale.
            .task(id: model.notificationChangeToken) { await load(reset: true) }
            .refreshable { await load(reset: true) }
            .onChange(of: model.isOffline) { _, offline in
                if !offline {
                    Task { await load(reset: true) }
                }
            }
            .rawkoonConfirm(
                "Delete this notification?",
                isPresented: Binding(
                    get: { pendingDeleteId != nil },
                    set: {
                        if !$0 {
                            pendingDeleteId = nil
                        }
                    }
                )
            ) {
                Button("Delete", role: .destructive) {
                    if let id = pendingDeleteId {
                        Task { await delete(id: id) }
                    }
                }
                .requiresConnection(model.isOffline)
                Button("Cancel", role: .cancel) {}
            }
    }

    private var phase: ListLoadPhase {
        ListLoadPhase.resolve(
            loading: loading, offline: model.isOffline, failed: errorMessage != nil,
            isEmpty: notifications.isEmpty, showsNothing: notifications.isEmpty
        )
    }

    /// One slot, so the spinner, the empty and error states and the list crossfade.
    private var content: some View {
        ZStack {
            switch phase {
            case .loading:
                ProgressView().tint(Theme.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.rawkoonSwap)
            case .offline:
                ContentUnavailableView(
                    "You're offline",
                    systemImage: "wifi.slash",
                    description: Text("This will load when you're back online.")
                )
                .rawkoonLivingSymbol(.error)
                .transition(.rawkoonSwap)
            case .failed:
                ContentUnavailableView(
                    "Couldn't load notifications",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage ?? "")
                )
                .rawkoonLivingSymbol(.error)
                .transition(.rawkoonSwap)
            case .empty:
                ContentUnavailableView(
                    "No notifications",
                    systemImage: "bell.slash",
                    description: Text("You're all caught up.")
                )
                .rawkoonLivingSymbol(.empty)
                .transition(.rawkoonSwap)
            case .list:
                notificationList
                    .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(initialLoadResolved ? RawkoonMotion.spring : nil, value: phase)
        .onAppear {
            if phase != .loading {
                initialLoadResolved = true
            }
        }
        .onChange(of: phase) { _, current in
            if current != .loading {
                initialLoadResolved = true
            }
        }
    }

    /// Release and update notices for the same version keep only the release one.
    private var hiddenIds: Set<Int> {
        NotificationLedger.hiddenUpdateNotices(notifications.compactMap { notification in
            switch notification.type {
            case "app-update":
                .init(id: notification.id, installed: notification.metadata?.version, announced: [])
            case "github-release":
                .init(
                    id: notification.id, installed: nil,
                    announced: notification.metadata?.releases?.map(\.tagName) ?? []
                )
            default:
                nil
            }
        })
    }

    private var sections: [NotificationLedger.Section<NotificationDTO>] {
        let hidden = hiddenIds
        return NotificationLedger.sections(
            notifications.filter { !hidden.contains($0.id) },
            date: { NotificationLedger.parseDate($0.createdAt) },
            now: Date()
        )
    }

    private var notificationList: some View {
        List {
            ForEach(sections) { section in
                Section {
                    ForEach(section.items) { notification in
                        row(notification)
                            .listRowBackground(Theme.raised)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive, action: OfflineFeedback.gate(model.isOffline) {
                                    pendingDeleteId = notification.id
                                }) {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                } header: {
                    NotificationDayHeader(day: section.day)
                }
            }
            // The sentinel would spin forever offline; it comes back with the connection.
            if hasMore, !model.isOffline {
                loadMoreRow
            }
        }
        // Arrivals, deletions and pages animate in and out of the list.
        .rawkoonMotion(RawkoonMotion.spring, value: notifications.map(\.id))
        .reportsTabBarScroll()
        .listStyle(.plain)
        .listSectionSpacing(0)
        .scrollContentBackground(.hidden)
        .task(id: hiddenIds) { await markHiddenRead() }
    }

    /// Infinite-scroll sentinel: appearing near the list's end pulls the next
    /// page; the spinner is just the loading indicator, not a manual trigger.
    private var loadMoreRow: some View {
        HStack {
            Spacer()
            ProgressView().tint(Theme.muted)
            Spacer()
        }
        .listRowBackground(Theme.raised)
        .listRowSeparator(.hidden)
        .onAppear { Task { await loadMore() } }
    }

    private func row(_ notification: NotificationDTO) -> some View {
        HStack(spacing: 10) {
            rowButton(notification)
            let action = InboxAction.resolve(type: notification.type, url: notification.url, isAdmin: model.isAdmin)
            if let action {
                actionButton(action, for: notification)
            }
        }
    }

    @ViewBuilder
    private func actionButton(_ action: InboxAction, for notification: NotificationDTO) -> some View {
        switch action {
        case .reviewRequests:
            Button("Review") {
                Task {
                    await markRead(notification)
                    model.requestedActivityLane = .requests
                }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.small)
            .tint(Theme.apricot)
            .frame(minHeight: 44)
        case let .searchAgain(libraryId, season, episode):
            Button {
                Task { await searchAgain(notification, libraryId: libraryId, season: season, episode: episode) }
            } label: {
                if searchingIds.contains(notification.id) {
                    ProgressView().tint(Theme.muted)
                } else {
                    Text("Search again")
                }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.small)
            .tint(Theme.apricot)
            .frame(minHeight: 44)
            .disabled(searchingIds.contains(notification.id))
            .requiresConnection(model.isOffline)
        }
    }

    private func rowButton(_ notification: NotificationDTO) -> some View {
        Button {
            Task { await open(notification) }
        } label: {
            NotificationLedgerRow(notification: notification, time: clockTime(notification.createdAt))
        }
        .buttonStyle(.plain)
    }

    // MARK: Networking

    /// Runs the search that gave up again, for the title, season or episode the notification names.
    /// The answer arrives through the item's live toast.
    private func searchAgain(_ notification: NotificationDTO, libraryId: Int, season: Int?, episode: Int?) async {
        guard let client = model.api(), searchingIds.insert(notification.id).inserted else { return }
        defer { searchingIds.remove(notification.id) }
        let item: LibraryMedia? = if let known = client.cachedLibraryItem(id: libraryId)?.value {
            known
        } else {
            try? await client.libraryItem(id: libraryId)
        }
        let title = item?.title ?? notification.title
        guard let season else {
            await model.autoSearchMovie(libraryId: libraryId, title: title)
            return
        }
        guard let episode else {
            await model.liveSearch.search(mediaId: libraryId, title: title, isShow: true) {
                try await client.searchSeason(id: libraryId, season: season)
            }
            return
        }
        let episodes = try? await client.libraryEpisodes(id: libraryId)
        let match = episodes?.seasons.first { $0.season == season }?.episodes.first { $0.episode == episode }
        guard let match else {
            model.toast(String(localized: "Couldn't find that episode."), style: .error)
            return
        }
        await model.liveSearch.search(mediaId: libraryId, title: title, isShow: true) {
            try await client.searchEpisode(id: libraryId, episodeId: match.id)
        }
    }

    /// Paints the first page from the last saved response, the same page `load` fetches.
    private func hydrateFromCache() {
        guard notifications.isEmpty, let client = model.api(),
              let cached = client.cached(Endpoints.notifications(page: 1, limit: limit))
        else { return }
        notifications = cached.value.notifications
        hasMore = (cached.value.pagination?.page ?? 1) < (cached.value.pagination?.pages ?? 1)
        loading = false
    }

    private func load(reset: Bool) async {
        guard let client = model.api() else {
            loading = false
            errorMessage = String(localized: "Not logged in.")
            return
        }
        if reset {
            page = 1
            loading = true
        }
        errorMessage = nil
        defer { loading = false }

        do {
            let response = try await client.notifications(page: page, limit: limit)
            notifications = response.notifications
            hasMore = (response.pagination?.page ?? page) < (response.pagination?.pages ?? page)
        } catch {
            errorMessage = String(localized: "Could not load notifications.")
        }
    }

    private func loadMore() async {
        guard !loadingMore, hasMore, let client = model.api() else { return }
        loadingMore = true
        defer { loadingMore = false }

        let nextPage = page + 1
        if let response = try? await client.notifications(page: nextPage, limit: limit) {
            notifications.append(contentsOf: response.notifications)
            page = nextPage
            hasMore = (response.pagination?.page ?? nextPage) < (response.pagination?.pages ?? nextPage)
        }
    }

    private func open(_ notification: NotificationDTO) async {
        await markRead(notification)
        model.navigate(toNotificationUrl: notification.url)
    }

    private func markRead(_ notification: NotificationDTO) async {
        // Offline the read flag can't reach the server, so the row stays unread.
        guard !notification.read, !model.isOffline else { return }
        markReadLocally(notification.id)
        if let client = model.api() {
            try? await client.markNotificationRead(id: notification.id)
            await model.refreshUnreadNotificationCount()
        }
    }

    /// Optimistic local update — mirrors the web app's `useMarkAsReadOptimistic`.
    private func markReadLocally(_ id: Int) {
        guard let index = notifications.firstIndex(where: { $0.id == id }) else { return }
        let current = notifications[index]
        notifications[index] = NotificationDTO(
            id: current.id, title: current.title, body: current.body, type: current.type,
            read: true, readAt: current.readAt, url: current.url, imageUrl: current.imageUrl,
            metadata: current.metadata, createdAt: current.createdAt
        )
    }

    private func markAllAsRead() async {
        guard let client = model.api() else { return }
        markingAllAsRead = true
        defer { markingAllAsRead = false }
        let unread = notifications.filter { !$0.read }
        for notification in unread {
            markReadLocally(notification.id)
        }
        do {
            try await client.markAllNotificationsRead()
        } catch {
            // Put back only the rows this call flipped; a live reload may have replaced the rest.
            for original in unread {
                if let index = notifications.firstIndex(where: { $0.id == original.id }) {
                    notifications[index] = original
                }
            }
            model.toast(message(for: error), style: .error)
        }
        await model.refreshUnreadNotificationCount()
    }

    private func delete(id: Int) async {
        guard let client = model.api(),
              let index = notifications.firstIndex(where: { $0.id == id })
        else { return }
        let removed = notifications.remove(at: index)
        do {
            try await client.deleteNotification(id: id)
        } catch {
            if !notifications.contains(where: { $0.id == id }) {
                notifications.insert(removed, at: min(index, notifications.count))
            }
            model.toast(message(for: error), style: .error)
        }
        await model.refreshUnreadNotificationCount()
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.userMessage() ?? String(localized: "Can't reach the server. Try again in a moment.")
    }

    /// The section header already dates the row, so the row shows the time of day.
    private func clockTime(_ isoString: String) -> String? {
        NotificationLedger.parseDate(isoString)?.formatted(date: .omitted, time: .shortened)
    }

    /// A hidden duplicate would otherwise keep the badge lit with nothing to open.
    private func markHiddenRead() async {
        for notification in notifications where hiddenIds.contains(notification.id) && !notification.read {
            await markRead(notification)
        }
    }
}
