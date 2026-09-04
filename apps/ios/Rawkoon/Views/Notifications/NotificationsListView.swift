import SwiftUI

/// Ports the web `/notifications` page (spec T5): a paginated, infinite-scroll
/// list with mark-all-as-read and per-row mark-read/delete. Opened from the
/// Home bell (`HomeView`); each row and the live banner (`NotificationBannerView`)
/// both resolve their tap through `AppModel.navigate(toNotificationUrl:)`.
struct NotificationsListView: View {
    @Environment(AppModel.self) private var model

    @State private var notifications: [NotificationDTO] = []
    @State private var page = 1
    @State private var hasMore = false
    @State private var loading = true
    @State private var loadingMore = false
    @State private var errorMessage: String?
    @State private var pendingDeleteId: Int?
    @State private var markingAllAsRead = false

    private let limit = 25

    var body: some View {
        content
            .background(Theme.base)
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !notifications.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Mark all read") {
                            Task { await markAllAsRead() }
                        }
                        .disabled(markingAllAsRead || !notifications.contains { !$0.read })
                    }
                }
            }
            // Keyed on the live token so a notification arriving while the list
            // is open refetches it (and cancels an in-flight load), instead of
            // only the bell badge updating while the list stays stale.
            .task(id: model.notificationChangeToken) { await load(reset: true) }
            .refreshable { await load(reset: true) }
            .confirmationDialog(
                "Delete this notification?",
                isPresented: Binding(
                    get: { pendingDeleteId != nil },
                    set: {
                        if !$0 {
                            pendingDeleteId = nil
                        }
                    }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let id = pendingDeleteId {
                        Task { await delete(id: id) }
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
    }

    @ViewBuilder private var content: some View {
        if loading, notifications.isEmpty {
            ProgressView().tint(Theme.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, notifications.isEmpty {
            ContentUnavailableView(
                "Couldn't load notifications",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
        } else if notifications.isEmpty {
            ContentUnavailableView(
                "No notifications",
                systemImage: "bell.slash",
                description: Text("You're all caught up.")
            )
        } else {
            List {
                ForEach(notifications) { notification in
                    row(notification)
                        .listRowBackground(Theme.raised)
                        .listRowSeparator(.hidden)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                pendingDeleteId = notification.id
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                }
                if hasMore {
                    loadMoreRow
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    private var loadMoreRow: some View {
        HStack {
            Spacer()
            if loadingMore {
                ProgressView().tint(Theme.muted)
            } else {
                Button("Load more") { Task { await loadMore() } }
                    .foregroundStyle(Theme.apricot)
            }
            Spacer()
        }
        .listRowBackground(Theme.raised)
        .listRowSeparator(.hidden)
        .onAppear { Task { await loadMore() } }
    }

    private func row(_ notification: NotificationDTO) -> some View {
        Button {
            Task { await open(notification) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                NotificationLeadingVisual(
                    type: notification.type, metadata: notification.metadata, imageUrl: notification.imageUrl
                )
                VStack(alignment: .leading, spacing: 4) {
                    Text(notification.title)
                        .font(.subheadline.weight(notification.read ? .medium : .semibold))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    Text(notification.body)
                        .font(.subheadline)
                        .foregroundStyle(notification.read ? Theme.muted : Theme.text)
                        .lineLimit(3)
                    Text(relativeTime(notification.createdAt) ?? notification.createdAt)
                        .font(.caption2)
                        .foregroundStyle(Theme.faint)
                }
                Spacer(minLength: 0)
                if !notification.read {
                    Circle().fill(Theme.apricot).frame(width: 8, height: 8).padding(.top, 4)
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    // MARK: Networking

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
        if !notification.read {
            markReadLocally(notification.id)
            if let client = model.api() {
                try? await client.markNotificationRead(id: notification.id)
                await model.refreshUnreadNotificationCount()
            }
        }
        model.navigate(toNotificationUrl: notification.url)
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
        try? await client.markAllNotificationsRead()
        for notification in notifications where !notification.read {
            markReadLocally(notification.id)
        }
        await model.refreshUnreadNotificationCount()
    }

    private func delete(id: Int) async {
        guard let client = model.api() else { return }
        notifications.removeAll { $0.id == id }
        try? await client.deleteNotification(id: id)
        await model.refreshUnreadNotificationCount()
    }

    private func relativeTime(_ isoString: String) -> String? {
        let formatterFraction = ISO8601DateFormatter()
        formatterFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatterPlain = ISO8601DateFormatter()
        formatterPlain.formatOptions = [.withInternetDateTime]
        guard let date = formatterFraction.date(from: isoString) ?? formatterPlain.date(from: isoString) else {
            return nil
        }
        let relativeFormatter = RelativeDateTimeFormatter()
        relativeFormatter.unitsStyle = .abbreviated
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}
