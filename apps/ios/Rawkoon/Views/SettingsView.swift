import SwiftUI

struct SettingsView: View {
    /// Which sections show: the sidebar splits personal settings from the admin ones.
    enum Scope {
        case all, personal, server
    }

    var scope: Scope = .all

    @Environment(AppModel.self) private var model
    @Environment(\.isActiveRootTab) private var isActiveRootTab
    @AppStorage("download_over") private var downloadOver = "any"
    @AppStorage("smart_rewind") private var smartRewind = false
    @AppStorage(AppLanguage.storageKey) private var appLanguage = AppLanguage.system.rawValue

    @State private var sessionUser: SessionUser?
    @State private var appVersion: String?
    @State private var savedDataBytes = 0
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
        guard model.isAdmin, scope != .personal else { return [] }
        return SettingsDestination.allCases.filter { $0.matches(settingsSearch) }
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
        .onAppear { savedDataBytes = model.savedDataBytes }
        .task {
            hydrateFromCache()
            await model.refreshAdminIfNeeded()
            await loadAccount()
            await loadVersion()
        }
        // Kept-alive iPhone tabs never re-appear, so a revisit refreshes like the old TabView did.
        .onChange(of: isActiveRootTab) { _, active in
            if active {
                Task { await loadAccount() }
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

    /// The phone gets one summary row per admin group; the sidebar's Server
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
                                Label(destination.title, systemImage: destination.systemImage)
                            }
                        }
                    } header: {
                        Text(group.title)
                    }
                    .listRowBackground(Theme.raised)
                }
            } else {
                Section("Server") {
                    ForEach(SettingsGroup.allCases) { group in
                        NavigationLink {
                            SettingsGroupView(group: group)
                        } label: {
                            SettingsNavRow(title: group.title, subtitle: group.summary, systemImage: group.systemImage)
                        }
                    }
                }
                .listRowBackground(Theme.raised)
            }
        }
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
                    version: appVersion,
                    isOffline: model.isOffline
                )
            }
        }
        .listRowBackground(Theme.raised)

        Section("You") {
            NavigationLink {
                SettingsAlertsView()
            } label: {
                SettingsNavRow(
                    title: "Notifications",
                    subtitle: String(localized: "Push, devices, channels"),
                    systemImage: "bell"
                )
            }
            NavigationLink {
                SettingsPlaybackView()
            } label: {
                SettingsNavRow(title: "Playback & downloads", subtitle: playbackSummary, systemImage: "play.circle")
            }
            NavigationLink {
                SettingsStorageView()
            } label: {
                SettingsNavRow(title: "Storage", subtitle: storageSummary, systemImage: "internaldrive")
            }
            Picker(selection: $appLanguage) {
                ForEach(AppLanguage.allCases) { language in
                    Text(language.label).tag(language.rawValue)
                }
            } label: {
                SettingsNavRow(title: "Language", systemImage: "globe")
            }
            .pickerStyle(.menu)
        }
        .listRowBackground(Theme.raised)

        // The sidebar has Activity and Requests tabs of its own; the phone reaches them only here.
        if scope == .all {
            Section("Activity") {
                NavigationLink {
                    ActivityView()
                } label: {
                    SettingsNavRow(title: "Activity", systemImage: "arrow.down.circle")
                }
                NavigationLink {
                    RequestsView()
                } label: {
                    SettingsNavRow(title: "Requests", systemImage: "tray.and.arrow.down")
                }
            }
            .listRowBackground(Theme.raised)
        }
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

    private var playbackSummary: String {
        let rewind = smartRewind ? String(localized: "Smart rewind on") : String(localized: "Smart rewind off")
        #if targetEnvironment(macCatalyst)
            return rewind
        #else
            let network = downloadOver == "wifi" ? String(localized: "Wi-Fi only") : String(localized: "Any network")
            return "\(rewind) \u{00B7} \(network)"
        #endif
    }

    private var storageSummary: String {
        let size = ByteCountFormatter.string(fromByteCount: Int64(savedDataBytes), countStyle: .file)
        return String(localized: "\(size) saved offline")
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
        } catch {
            // Best-effort only; do not fail the screen.
        }
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
