import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("download_over") private var downloadOver = "any"
    @AppStorage("smart_rewind") private var smartRewind = false

    @State private var sessionUser: SessionUser?
    @State private var appVersion: String?
    @State private var confirmDeleteDownloads = false
    @State private var confirmLogOut = false
    @State private var settingsSearch = ""

    private var isSearching: Bool {
        !settingsSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var searchResults: [SettingsDestination] {
        guard model.isAdmin else { return [] }
        return SettingsDestination.allCases.filter { $0.matches(settingsSearch) }
    }

    var body: some View {
        @Bindable var model = model
        return Form {
            if isSearching {
                searchResultsSection
            } else {
                staticSections
                adminSections
            }
        }
        .searchable(
            text: $settingsSearch,
            placement: .navigationBarDrawer(displayMode: .automatic),
            prompt: String(localized: "Search settings")
        )
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            "Delete downloaded chapters?",
            isPresented: $confirmDeleteDownloads,
            titleVisibility: .visible
        ) {
            Button("Delete Downloads", role: .destructive) {
                model.deleteDownloads()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes offline audiobook chapters from this iPhone. Playback will need the network until they download again.")
        }
        .confirmationDialog(
            "Log out of Rawkoon?",
            isPresented: $confirmLogOut,
            titleVisibility: .visible
        ) {
            Button("Log Out", role: .destructive) {
                model.logout()
            }
            Button("Cancel", role: .cancel) {}
        }
        .task {
            await model.refreshAdminIfNeeded()
            await loadAccount()
            await loadVersion()
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

    @ViewBuilder
    private var adminSections: some View {
        if model.isAdmin {
            ForEach(SettingsGroup.allCases) { group in
                let items = SettingsDestination.allCases.filter { $0.group == group }
                Section {
                    ForEach(items) { destination in
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
        }
    }

    @ViewBuilder
    private var staticSections: some View {
        @Bindable var model = model
        Group {
            Section("Account") {
                TextField("Server URL", text: $model.serverURL)
                    .disabled(true)
                    .textSelection(.enabled)
                    .foregroundStyle(Theme.muted)

                if let user = sessionUser {
                    if let email = user.email, !email.isEmpty {
                        LabeledContent("Email") {
                            Text(email)
                                .foregroundStyle(Theme.text)
                                .textSelection(.enabled)
                        }
                    }
                    if let displayName = displayName(for: user), !displayName.isEmpty {
                        LabeledContent("Name") {
                            Text(displayName)
                                .foregroundStyle(Theme.text)
                        }
                    }
                }

                NavigationLink {
                    ProfileView()
                } label: {
                    Label("Edit profile", systemImage: "person.crop.circle")
                }
            }
            .listRowBackground(Theme.raised)

            Section("Requests & Alerts") {
                NavigationLink {
                    RequestsView()
                } label: {
                    Label("Requests", systemImage: "tray.and.arrow.down")
                }

                NavigationLink {
                    NotificationsSettingsView()
                } label: {
                    Label("Notifications", systemImage: "bell")
                }

                NavigationLink {
                    DevicesView()
                } label: {
                    Label("Devices", systemImage: "iphone")
                }

                NavigationLink {
                    NotificationChannelsCrudView()
                } label: {
                    Label("Channels", systemImage: "paperplane")
                }
            }
            .listRowBackground(Theme.raised)

            Section {
                Toggle("Smart rewind", isOn: $smartRewind)
            } header: {
                Text("Playback")
            } footer: {
                Text("Rewind when a book resumes, by how long it was paused \u{2014} nothing under ten seconds, two seconds under a minute, ten under an hour, twenty after a night's sleep.")
            }
            .listRowBackground(Theme.raised)

            Section("Downloads") {
                Picker("Download over", selection: $downloadOver) {
                    Text("Any").tag("any")
                    Text("Wi-Fi").tag("wifi")
                }
                .pickerStyle(.segmented)

                Button("Delete Downloads", role: .destructive) {
                    confirmDeleteDownloads = true
                }
            }
            .listRowBackground(Theme.raised)

            Section("About") {
                LabeledContent("Version") {
                    Text("Rawkoon \(appVersion ?? "—")")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
            .listRowBackground(Theme.raised)

            Section {
                Button("Log Out", role: .destructive) {
                    confirmLogOut = true
                }
            }
            .listRowBackground(Theme.raised)
        }
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
