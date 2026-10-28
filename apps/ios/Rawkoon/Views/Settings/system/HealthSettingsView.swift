import RawkoonKit
import SwiftUI

/// System > Health: can Rawkoon find, grab and import right now? One page over the grab readiness
/// checks, the latest library health run, open attention alerts and the last RSS run, each with its
/// fix link.
struct HealthSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var checks: [GrabReadinessCheck]?
    @State private var checksFailed = false
    @State private var health: LibraryHealthLog?
    @State private var healthLoaded = false
    @State private var healthFailed = false
    @State private var attention: [AttentionItem]?
    @State private var attentionFailed = false
    @State private var missingSearchCount: Int?
    @State private var missingSearchesFailed = false
    @State private var rss: RssStatusResponse?
    @State private var rssFailed = false
    /// Issues whose Ignore is in flight, hidden right away so the list answers the tap.
    @State private var ignoringKeys: Set<String> = []

    var body: some View {
        Group {
            if model.isAdmin {
                form
            } else {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            }
        }
        .navigationTitle("Health")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            readinessSection
            libraryHealthSection
            attentionSection
            rssSection
        }
        .settingsScreenStyle()
        .refreshable { await refresh() }
        .task { await refresh() }
    }

    // MARK: Ready to grab

    private var readinessSection: some View {
        Section {
            if let checks {
                ForEach(GrabReadiness.visible(checks)) { check in
                    if let target = SettingsDestination.fix(for: check) {
                        NavigationLink {
                            target.destination
                        } label: {
                            GrabReadinessRowLabel(check: check)
                        }
                    } else {
                        GrabReadinessRowLabel(check: check)
                    }
                }
            } else if checksFailed {
                failureRow("Couldn't run the checks.")
            } else {
                loadingRow
            }
        } header: {
            Text("Ready to grab")
        } footer: {
            if let checks {
                let problems = GrabReadiness.problemCount(checks)
                if problems == 0 {
                    Text("Everything automatic grabbing needs is in place.")
                } else if problems == 1 {
                    Text("1 thing to fix")
                } else {
                    Text("\(problems) things to fix")
                }
            }
        }
        .listRowBackground(Theme.raised)
    }

    // MARK: Library health

    private var libraryHealthSection: some View {
        Section {
            if let health {
                LabeledContent("Last run") {
                    Text(verbatim: lastRunText(health))
                        .foregroundStyle(Theme.muted)
                }
                if let error = health.error, !error.isEmpty {
                    Text(verbatim: error).font(.footnote).foregroundStyle(Theme.terracotta)
                }
                if health.issueCount == 0 {
                    Label("No issues found", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Theme.seed)
                }
                let issues = (health.issues ?? []).filter { $0.key.map { !ignoringKeys.contains($0) } ?? true }
                ForEach(Array(issues.prefix(8).enumerated()), id: \.offset) { _, issue in
                    issueRow(issue)
                }
                if issues.count > 8 {
                    Text("\(issues.count - 8) more issues")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                if let ignored = health.ignoredCount, ignored > 0 {
                    NavigationLink {
                        IgnoredHealthIssuesView { await refresh() }
                    } label: {
                        LabeledContent("Ignored issues") {
                            Text("\(ignored)").foregroundStyle(Theme.muted)
                        }
                    }
                }
            } else if healthFailed {
                failureRow("Couldn't load the library health run.")
            } else if healthLoaded {
                Text("The library health check hasn't run yet.")
                    .font(.subheadline).foregroundStyle(Theme.muted)
            } else {
                loadingRow
            }
        } header: {
            Text("Library health")
        } footer: {
            if health?.issues?.contains(where: { $0.key != nil }) == true {
                Text("Swipe an issue to ignore it when it's expected, like a two-part episode stored as one file.")
            }
        }
        .listRowBackground(Theme.raised)
    }

    private func issueRow(_ issue: LibraryHealthIssue) -> some View {
        Group {
            if let destination = issueDestination(issue) {
                NavigationLink {
                    NotificationDestinationView(destination: destination)
                } label: {
                    issueLabel(issue)
                }
            } else {
                issueLabel(issue)
            }
        }
        .swipeActions(edge: .trailing) {
            if let key = issue.key {
                Button {
                    Task { await ignore(key) }
                } label: {
                    Label("Ignore", systemImage: "eye.slash")
                }
                .tint(Theme.muted)
            }
        }
        .contextMenu {
            if let key = issue.key {
                Button {
                    Task { await ignore(key) }
                } label: {
                    Label("Ignore", systemImage: "eye.slash")
                }
            }
        }
    }

    private func ignore(_ key: String) async {
        guard let client = model.api(), ignoringKeys.insert(key).inserted else { return }
        do {
            try await client.ignoreLibraryHealthIssue(key: key)
            await loadHealth(client)
        } catch {
            model.toast(String(localized: "Couldn't ignore this issue."), style: .error)
        }
        ignoringKeys.remove(key)
    }

    private func issueLabel(_ issue: LibraryHealthIssue) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let title = issue.title, !title.isEmpty {
                Text(verbatim: title).foregroundStyle(Theme.textStrong)
            }
            Text(verbatim: issue.detail).font(.footnote).foregroundStyle(Theme.muted)
        }
    }

    private func issueDestination(_ issue: LibraryHealthIssue) -> NotificationDestination? {
        if let mediaId = issue.mediaId {
            return .media(libraryId: mediaId, season: nil, episode: nil, focusManagement: true)
        }
        if let bookId = issue.bookId, model.booksEnabled {
            return .book(bookId: bookId)
        }
        return nil
    }

    private func lastRunText(_ run: LibraryHealthLog) -> String {
        guard let completed = run.completedAt ?? run.startedAt else { return run.status.capitalized }
        let when = ActivityPresentation.relativeTime(completed)
        return when.isEmpty ? run.status.capitalized : "\(run.status.capitalized) \u{00B7} \(when)"
    }

    // MARK: Attention

    private var attentionSection: some View {
        Section {
            NavigationLink {
                MissingLibraryView()
            } label: {
                HStack {
                    Label("Searches that found nothing", systemImage: "magnifyingglass")
                    Spacer()
                    if let missingSearchCount {
                        Text("\(missingSearchCount)").foregroundStyle(Theme.muted)
                    } else if missingSearchesFailed {
                        Image(systemName: "exclamationmark.circle").foregroundStyle(Theme.terracotta)
                    } else {
                        ProgressView()
                    }
                }
            }
            if let attention {
                if attention.isEmpty {
                    Label("Nothing needs attention", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Theme.seed)
                }
                ForEach(attention) { item in
                    attentionRow(item)
                }
            } else if attentionFailed {
                failureRow("Couldn't load the alerts.")
            } else {
                loadingRow
            }
        } header: {
            Text("Needs attention")
        }
        .listRowBackground(Theme.raised)
    }

    @ViewBuilder
    private func attentionRow(_ item: AttentionItem) -> some View {
        let label = VStack(alignment: .leading, spacing: 2) {
            if let title = item.mediaTitle, !title.isEmpty {
                Text(verbatim: title).foregroundStyle(Theme.textStrong)
            }
            if let detail = item.detail, !detail.isEmpty {
                Text(verbatim: detail).font(.footnote).foregroundStyle(Theme.muted)
            }
        }
        if let mediaId = item.mediaId {
            NavigationLink {
                NotificationDestinationView(
                    destination: .media(libraryId: mediaId, season: nil, episode: nil, focusManagement: true)
                )
            } label: {
                label
            }
        } else {
            label
        }
    }

    // MARK: RSS

    private var rssSection: some View {
        Section {
            if let rss {
                if let run = rss.lastRun {
                    LabeledContent("Last run") {
                        Text(verbatim: rssRunText(run)).foregroundStyle(Theme.muted)
                    }
                    if let found = run.releasesFound {
                        LabeledContent("Releases found") { Text("\(found)").foregroundStyle(Theme.muted) }
                    }
                    if let grabbed = run.releasesGrabbed {
                        LabeledContent("Grabbed") { Text("\(grabbed)").foregroundStyle(Theme.muted) }
                    }
                    if let error = run.error, !error.isEmpty {
                        Text(verbatim: error).font(.footnote).foregroundStyle(Theme.terracotta)
                    }
                } else {
                    Text("The RSS check hasn't run yet.").font(.subheadline).foregroundStyle(Theme.muted)
                }
                NavigationLink {
                    SettingsDestination.autoGrab.destination
                } label: {
                    Label("Check schedule", systemImage: "clock")
                }
            } else if rssFailed {
                failureRow("Couldn't load the RSS status.")
            } else {
                loadingRow
            }
        } header: {
            Text("RSS")
        }
        .listRowBackground(Theme.raised)
    }

    private func rssRunText(_ run: RssRun) -> String {
        let status = (run.status ?? "").capitalized
        let when = ActivityPresentation.relativeTime(run.completedAt)
        return [status, when].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    // MARK: Shared

    private var loadingRow: some View {
        HStack {
            Spacer()
            ProgressView().tint(Theme.apricot)
            Spacer()
        }
    }

    private func failureRow(_ text: LocalizedStringKey) -> some View {
        Text(text).foregroundStyle(Theme.terracotta)
    }

    private func refresh() async {
        guard let client = model.api() else { return }
        async let readiness: Void = loadChecks(client)
        async let library: Void = loadHealth(client)
        async let alerts: Void = loadAttention(client)
        async let misses: Void = loadMissingSearches(client)
        async let feed: Void = loadRss(client)
        _ = await (readiness, library, alerts, misses, feed)
    }

    private func loadChecks(_ client: APIClient) async {
        do {
            checks = try await client.grabReadiness(refresh: true)
            checksFailed = false
        } catch {
            checksFailed = checks == nil
        }
    }

    private func loadHealth(_ client: APIClient) async {
        do {
            health = try await client.libraryHealth().latest
            healthLoaded = true
            healthFailed = false
        } catch {
            healthFailed = !healthLoaded
        }
    }

    private func loadAttention(_ client: APIClient) async {
        do {
            attention = try await client.libraryAttention().items
            attentionFailed = false
        } catch {
            attentionFailed = attention == nil
        }
    }

    private func loadMissingSearches(_ client: APIClient) async {
        do {
            missingSearchCount = try await MissingLibrarySearches.load(client: client).count
            missingSearchesFailed = false
        } catch {
            missingSearchesFailed = missingSearchCount == nil
        }
    }

    private func loadRss(_ client: APIClient) async {
        do {
            rss = try await client.rssStatus()
            rssFailed = false
        } catch {
            rssFailed = rss == nil
        }
    }
}

/// Issues the admin ignored, each with a way to count it again.
private struct IgnoredHealthIssuesView: View {
    @Environment(AppModel.self) private var model
    /// Reloads Health behind this screen so its counts follow a restore.
    let onChange: () async -> Void

    @State private var ignores: [LibraryHealthIgnore]?
    @State private var failed = false
    @State private var restoringIds: Set<Int> = []

    var body: some View {
        Form {
            Section {
                if let ignores {
                    if ignores.isEmpty {
                        Text("Nothing is ignored.").foregroundStyle(Theme.muted)
                    }
                    ForEach(ignores) { ignored in
                        VStack(alignment: .leading, spacing: 2) {
                            if let title = ignored.title, !title.isEmpty {
                                Text(verbatim: title).foregroundStyle(Theme.textStrong)
                            }
                            Text(verbatim: ignored.detail).font(.footnote).foregroundStyle(Theme.muted)
                        }
                        .swipeActions(edge: .trailing) {
                            Button("Restore") { Task { await restore(ignored) } }
                                .tint(Theme.apricot)
                        }
                        .contextMenu {
                            Button("Restore") { Task { await restore(ignored) } }
                        }
                    }
                } else if failed {
                    Text("Couldn't load the ignored issues.").foregroundStyle(Theme.terracotta)
                } else {
                    ProgressView().tint(Theme.apricot).frame(maxWidth: .infinity)
                }
            } footer: {
                Text("Ignored issues stop counting toward the badge. Restore one to count it again.")
            }
            .listRowBackground(Theme.raised)
        }
        .settingsScreenStyle()
        .navigationTitle("Ignored issues")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let client = model.api() else { return }
        do {
            ignores = try await client.libraryHealthIgnores()
            failed = false
        } catch {
            failed = ignores == nil
        }
    }

    private func restore(_ ignored: LibraryHealthIgnore) async {
        guard let client = model.api(), restoringIds.insert(ignored.id).inserted else { return }
        defer { restoringIds.remove(ignored.id) }
        do {
            try await client.restoreLibraryHealthIssue(id: ignored.id)
            ignores?.removeAll { $0.id == ignored.id }
            await onChange()
        } catch {
            model.toast(String(localized: "Couldn't restore this issue."), style: .error)
        }
    }
}

/// The count on the System row: everything Health would ask the admin to look at.
enum SystemHealthProbe {
    /// Nil when none of the four sources answered, so a failed probe never shows a made-up count.
    static func problemCount(client: APIClient) async -> Int? {
        async let checks = try? client.grabReadiness()
        async let health = try? client.libraryHealth()
        async let attention = try? client.libraryAttention()
        async let rss = try? client.rssStatus()
        let (readiness, library, alerts, feed) = await (checks, health, attention, rss)
        if readiness == nil, library == nil, alerts == nil, feed == nil {
            return nil
        }
        return SystemHealth.problemCount(
            readinessProblems: GrabReadiness.problemCount(readiness ?? []),
            attentionItems: alerts?.items.count ?? 0,
            libraryIssues: SystemHealth.libraryProblems(
                issueCount: library?.latest?.issueCount ?? 0, status: library?.latest?.status
            ),
            rssFailed: SystemHealth.rssFailed(status: feed?.lastRun?.status)
        )
    }
}
