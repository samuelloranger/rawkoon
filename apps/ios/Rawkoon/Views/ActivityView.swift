import SwiftUI

/// Tab root: download queue, recent history, and the upcoming calendar.
struct ActivityView: View {
    @EnvironmentObject private var model: AppModel

    private enum Lane: String, CaseIterable, Identifiable {
        case queue = "Queue"
        case history = "History"
        case calendar = "Calendar"
        var id: String {
            rawValue
        }
    }

    @State private var lane: Lane = .queue

    /// Header speed
    @State private var speed: SpeedResponse?

    // Queue
    @State private var queueRows: [QueueRow] = []
    @State private var loadingQueue = false
    @State private var queueError: String?

    // History
    @State private var activities: [ActivityRecord] = []
    @State private var loadingHistory = false
    @State private var historyError: String?

    // Calendar
    @State private var upcomingItems: [UpcomingItem] = []
    @State private var loadingCalendar = false
    @State private var calendarError: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Lane", selection: $lane) {
                ForEach(Lane.allCases) { lane in
                    Text(lane.rawValue).tag(lane)
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
    }

    // MARK: Header

    private func speedHeader(_ speed: SpeedResponse) -> some View {
        HStack(spacing: 14) {
            Label(formatSpeed(speed.dlSpeed), systemImage: "arrow.down")
            Label(formatSpeed(speed.ulSpeed), systemImage: "arrow.up")
            Spacer()
        }
        .font(.system(.caption, design: .monospaced))
        .foregroundStyle(Theme.faint)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func formatSpeed(_ bytesPerSecond: Double) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        formatter.allowedUnits = [.useAll]
        // Non-finite/overflowing rates would trap the non-failable Int64 init.
        let safeBytes = max(0, Int64(exactly: bytesPerSecond.rounded()) ?? 0)
        let formatted = formatter.string(fromByteCount: safeBytes)
        return "\(formatted)/s"
    }

    // MARK: Queue

    private struct QueueRow: Identifiable {
        let id: String
        let mediaTitle: String
        let releaseTitle: String
        let live: LiveDownload
    }

    @ViewBuilder
    private var queueContent: some View {
        if loadingQueue {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity, minHeight: 420)
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
            LazyVStack(spacing: 10) {
                ForEach(queueRows) { row in
                    queueCard(row)
                }
            }
            .padding(16)
        }
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
                StatusBadge(text: row.live.state, tint: stateTint(row.live.state))
            }

            DuskProgress(value: row.live.progress)

            HStack(spacing: 10) {
                Text("↓ \(formatSpeed(row.live.downloadSpeed))")
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
            queueError = "Not signed in."
            return
        }

        do {
            let list = try await client.libraryList(status: "downloading")
            var rows: [QueueRow] = []
            for media in list.items {
                do {
                    let downloads = try await client.downloads(libraryId: media.id)
                    for item in downloads.items {
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
                } catch {
                    // Skip items whose per-media download lookup fails; keep the rest.
                    continue
                }
            }
            queueRows = rows
        } catch let error as APIError {
            queueError = message(for: error)
        } catch {
            queueError = "Network error. Check your connection."
        }
    }

    // MARK: History

    @ViewBuilder
    private var historyContent: some View {
        if loadingHistory {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity, minHeight: 420)
        } else if let historyError {
            errorView(historyError)
        } else if activities.isEmpty {
            ContentUnavailableView(
                "No recent activity",
                systemImage: "clock.arrow.circlepath",
                description: Text("Nothing has happened yet.")
            )
            .foregroundStyle(Theme.faint)
            .frame(maxWidth: .infinity, minHeight: 420)
        } else {
            LazyVStack(spacing: 8) {
                ForEach(Array(activities.enumerated()), id: \.offset) { _, activity in
                    historyRow(activity)
                }
            }
            .padding(16)
        }
    }

    private func historyRow(_ activity: ActivityRecord) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if activity.success == false {
                Circle()
                    .fill(Theme.terracotta)
                    .frame(width: 7, height: 7)
                    .padding(.top, 5)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(activity.releaseTitle ?? activity.message ?? activity.type ?? "Activity")
                    .font(.subheadline)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                Text(historyMetaLine(activity))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
    }

    private func historyMetaLine(_ activity: ActivityRecord) -> String {
        var parts: [String] = []
        if let service = activity.service, !service.isEmpty {
            parts.append(service)
        }
        if let completedAt = activity.completedAt, let relative = relativeTime(completedAt) {
            parts.append(relative)
        }
        return parts.isEmpty ? "—" : parts.joined(separator: " · ")
    }

    private func loadHistory() async {
        loadingHistory = true
        historyError = nil
        defer { loadingHistory = false }

        guard let client = model.api() else {
            historyError = "Not signed in."
            return
        }

        do {
            let feed = try await client.activityFeed(limit: 50)
            activities = feed.activities
        } catch let error as APIError {
            historyError = message(for: error)
        } catch {
            historyError = "Network error. Check your connection."
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
            calendarError = "Not signed in."
            return
        }

        do {
            let response = try await client.upcoming()
            upcomingItems = response.items
        } catch let error as APIError {
            calendarError = message(for: error)
        } catch {
            calendarError = "Network error. Check your connection."
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

    private func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            return "Sign in required."
        case let .http(status):
            return "Server error (\(status))."
        case .decode:
            return "Could not parse server response."
        case .transport:
            return "Network error. Check your connection."
        }
    }
}
