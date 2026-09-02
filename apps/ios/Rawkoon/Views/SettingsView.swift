import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("download_over") private var downloadOver = "any"
    @AppStorage("smart_rewind") private var smartRewind = false

    @State private var sessionUser: SessionUser?
    @State private var appVersion: String?
    @State private var confirmDeleteDownloads = false
    @State private var confirmLogOut = false

    var body: some View {
        @Bindable var model = model
        return Form {
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
            }
            .listRowBackground(Theme.raised)

            if model.isAdmin {
                Section("Admin") {
                    NavigationLink {
                        GeneralSettingsView()
                    } label: {
                        Label("General", systemImage: "globe")
                    }

                    NavigationLink {
                        TmdbIntegrationView()
                    } label: {
                        Label("TMDB", systemImage: "film")
                    }

                    NavigationLink {
                        JellyfinIntegrationView()
                    } label: {
                        Label("Jellyfin", systemImage: "play.rectangle")
                    }

                    NavigationLink {
                        LocalAiIntegrationView()
                    } label: {
                        Label("Local AI", systemImage: "brain")
                    }

                    NavigationLink {
                        IndexerManagerIntegrationView(kind: .prowlarr)
                    } label: {
                        Label("Prowlarr", systemImage: "magnifyingglass.circle")
                    }

                    NavigationLink {
                        IndexerManagerIntegrationView(kind: .jackett)
                    } label: {
                        Label("Jackett", systemImage: "magnifyingglass.circle")
                    }

                    NavigationLink {
                        BooksProviderView()
                    } label: {
                        Label("Book providers", systemImage: "books.vertical")
                    }

                    NavigationLink {
                        BooksSettingsView()
                    } label: {
                        Label("Books", systemImage: "book")
                    }

                    NavigationLink {
                        MediaLibrarySettingsView()
                    } label: {
                        Label("Library", systemImage: "folder")
                    }

                    NavigationLink {
                        ArrLibraryImportView()
                    } label: {
                        Label("Import from Radarr/Sonarr", systemImage: "square.and.arrow.down")
                    }

                    NavigationLink {
                        QualityProfilesCrudView()
                    } label: {
                        Label("Quality profiles", systemImage: "slider.horizontal.3")
                    }

                    NavigationLink {
                        IndexersView()
                    } label: {
                        Label("Indexers", systemImage: "magnifyingglass")
                    }

                    NavigationLink {
                        DownloadClientEditView()
                    } label: {
                        Label("Download client", systemImage: "arrow.down.circle")
                    }

                    NavigationLink {
                        UsersView()
                    } label: {
                        Label("Users", systemImage: "person.2")
                    }
                }
                .listRowBackground(Theme.raised)
            }

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
