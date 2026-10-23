import SwiftUI

struct SettingsView: View {
    /// Which sections show: the sidebar splits personal settings from the admin ones.
    enum Scope {
        case all, personal, server
    }

    var scope: Scope = .all

    @Environment(AppModel.self) private var model
    @Environment(\.isActiveRootTab) private var isActiveRootTab
    @AppStorage("smart_rewind") private var smartRewind = false
    @AppStorage("download_over") private var downloadOver = "any"

    @State private var sessionUser: SessionUser?
    @State private var appVersion: String?
    /// Open problems System > Health would list, for the badge on the System row; admins only.
    @State private var healthProblems = 0
    @State private var settingsSearch = ""

    private var isSearching: Bool {
        !settingsSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var navigationTitleKey: LocalizedStringKey {
        switch scope {
        case .all: "Settings"
        case .personal: "Preferences"
        case .server: "Server"
        }
    }

    private var searchResults: [SettingsDestination] {
        guard scope != .personal else { return [] }
        return SettingsDestination.allCases.filter { (model.isAdmin || !$0.isAdminOnly) && $0.matches(settingsSearch) }
    }

    var body: some View {
        Form {
            if isSearching {
                searchResultsSection
            } else {
                if scope != .server {
                    personalSections
                }
                if scope != .personal {
                    adminSections
                }
                if scope != .server {
                    aboutFooter
                }
            }
        }
        .reportsTabBarScroll()
        .modifier(SettingsSearch(isEnabled: scope != .personal, text: $settingsSearch))
        .settingsScreenStyle()
        .navigationTitle(navigationTitleKey)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            hydrateFromCache()
            await model.refreshAdminIfNeeded()
            await loadAccount()
            await loadVersion()
            await loadHealth()
        }
        // Kept-alive iPhone tabs never re-appear, so a revisit refreshes like the old TabView did.
        .onChange(of: isActiveRootTab) { _, active in
            if active {
                Task {
                    await loadAccount()
                    await loadHealth()
                }
            }
        }
        .onChange(of: model.reconnectToken) { _, _ in
            Task {
                await loadAccount()
                await loadVersion()
            }
        }
    }

    @ViewBuilder
    private var searchResultsSection: some View {
        Section {
            if searchResults.isEmpty {
                Text("No settings match \u{201C}\(settingsSearch)\u{201D}")
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(searchResults) { destination in
                    NavigationLink {
                        destination.destination
                    } label: {
                        Label(destination.title, systemImage: destination.systemImage)
                    }
                }
            }
        }
        .listRowBackground(Theme.raised)
    }

    /// The phone gets one row per server page and one for System; the sidebar's Server
    /// screen has the room to list every row inline.
    @ViewBuilder
    private var adminSections: some View {
        if model.isAdmin {
            if scope == .server {
                ForEach(SettingsGroup.allCases) { group in
                    Section {
                        ForEach(group.destinations) { destination in
                            NavigationLink {
                                destination.destination
                            } label: {
                                SettingsDestinationRow(destination: destination, badge: badge(for: destination))
                            }
                        }
                    } header: {
                        Text(group.title)
                    }
                    .listRowBackground(Theme.raised)
                }
            } else {
                Section("Server") {
                    ForEach(SettingsGroup.server) { group in
                        groupLink(group)
                    }
                }
                .listRowBackground(Theme.raised)
                Section {
                    groupLink(.system, badge: healthProblems)
                }
                .listRowBackground(Theme.raised)
            }
        }
    }

    /// A page with several screens opens its list; a page with one opens that screen.
    @ViewBuilder
    private func groupLink(_ group: SettingsGroup, badge: Int = 0) -> some View {
        if let only = group.destinations.first, group.destinations.count == 1 {
            NavigationLink {
                only.destination
            } label: {
                SettingsNavRow(title: group.title, subtitle: group.summary, systemImage: group.systemImage)
            }
        } else {
            NavigationLink {
                SettingsGroupView(group: group, badges: badges)
            } label: {
                HStack {
                    SettingsNavRow(title: group.title, subtitle: group.summary, systemImage: group.systemImage)
                    Spacer(minLength: 8)
                    SettingsCountBadge(count: badge)
                }
            }
        }
    }

    private var badges: [SettingsDestination: Int] {
        [.health: healthProblems]
    }

    private func badge(for destination: SettingsDestination) -> Int {
        badges[destination] ?? 0
    }

    @ViewBuilder
    private var personalSections: some View {
        Section {
            NavigationLink {
                SettingsAccountView(name: accountName, email: sessionUser?.email, version: appVersion)
            } label: {
                SettingsProfileCard(
                    name: accountName,
                    email: sessionUser?.email,
                    initials: model.userInitials,
                    avatarURL: model.userAvatarURL,
                    version: appVersion,
                    isOffline: model.isOffline
                )
            }
        }
        .listRowBackground(Theme.raised)

        Section("You") {
            NavigationLink {
                SettingsSecurityView()
            } label: {
                SettingsNavRow(
                    title: "Security",
                    subtitle: String(localized: "Password, passkeys, calendar link"),
                    systemImage: SettingsDestination.security.systemImage
                )
            }
            NavigationLink {
                SettingsAlertsView()
            } label: {
                SettingsNavRow(
                    title: "Alerts",
                    subtitle: String(localized: "Push, devices, channels"),
                    systemImage: SettingsDestination.alerts.systemImage
                )
            }
            NavigationLink {
                SettingsAppView()
            } label: {
                SettingsNavRow(
                    title: "App",
                    subtitle: appSummary,
                    systemImage: SettingsDestination.appPreferences.systemImage
                )
            }
        }
        .listRowBackground(Theme.raised)
    }

    private var aboutFooter: some View {
        Section {
            VStack(spacing: 6) {
                Text("Rawkoon \(appVersion ?? "—")")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                HStack(spacing: 16) {
                    if let url = URL(string: "https://samlo.cloud/rawkoon/privacy") {
                        Link("Privacy policy", destination: url)
                    }
                    if let url = URL(string: "https://github.com/samuelloranger/rawkoon/issues") {
                        Link("Support", destination: url)
                    }
                }
                .font(.footnote)
            }
            .frame(maxWidth: .infinity)
        }
        .listRowBackground(Color.clear)
    }

    private var accountName: String? {
        sessionUser.flatMap(displayName(for:))
    }

    /// Playback and download preferences at a glance, for the App row.
    private var appSummary: String {
        let rewind = smartRewind ? String(localized: "Smart rewind on") : String(localized: "Smart rewind off")
        #if targetEnvironment(macCatalyst)
            return rewind
        #else
            let network = downloadOver == "wifi" ? String(localized: "Wi-Fi only") : String(localized: "Any network")
            return "\(rewind) \u{00B7} \(network)"
        #endif
    }

    private func displayName(for user: SessionUser) -> String? {
        let composedName = [user.firstName, user.lastName]
            .compactMap(\.self)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !composedName.isEmpty {
            return composedName
        }
        return user.name
    }

    /// The account rows and server version paint from the last saved answers,
    /// so offline they show the known values instead of vanishing.
    private func hydrateFromCache() {
        guard let client = model.api() else { return }
        if sessionUser == nil, let cached = client.cached(Endpoints.currentUser) {
            sessionUser = cached.value.user
        }
        if appVersion == nil, let cached = client.cached(Endpoints.systemVersion) {
            appVersion = cached.value.version
        }
    }

    private func loadAccount() async {
        guard let client = model.api() else { return }
        do {
            let session = try await client.currentUser()
            sessionUser = session.user
            // The tab bar and the profile card read the model, so a changed picture or name reaches them too.
            if let user = session.user {
                model.applyUser(user)
            }
        } catch {
            // Best-effort only; do not fail the screen.
        }
    }

    private func loadHealth() async {
        // No badge beats a stale one: offline or unanswered, the count is hidden.
        guard model.isAdmin, !model.isOffline, let client = model.api() else {
            healthProblems = 0
            return
        }
        healthProblems = await SystemHealthProbe.problemCount(client: client) ?? 0
    }

    private func loadVersion() async {
        guard let client = model.api() else { return }
        do {
            let version = try await client.systemVersion()
            appVersion = version.version
        } catch {
            // Best-effort only; do not fail the screen.
        }
    }
}

private struct SettingsSearch: ViewModifier {
    let isEnabled: Bool
    @Binding var text: String

    func body(content: Content) -> some View {
        if isEnabled {
            content.searchable(
                text: $text,
                placement: .navigationBarDrawer(displayMode: .automatic),
                prompt: String(localized: "Search settings")
            )
        } else {
            content
        }
    }
}
