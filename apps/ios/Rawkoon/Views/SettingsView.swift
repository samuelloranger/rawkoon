import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("download_over") private var downloadOver = "any"

    @State private var sessionUser: SessionUser?
    @State private var appVersion: String?

    var body: some View {
        Form {
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

            Section("Management") {
                NavigationLink {
                    RequestsView()
                } label: {
                    Label("Requests", systemImage: "tray.and.arrow.down")
                }

                NavigationLink {
                    QualityProfilesView()
                } label: {
                    Label("Quality profiles", systemImage: "slider.horizontal.3")
                }

                NavigationLink {
                    IndexersView()
                } label: {
                    Label("Indexers", systemImage: "magnifyingglass")
                }

                NavigationLink {
                    DownloadClientView()
                } label: {
                    Label("Download client", systemImage: "arrow.down.circle")
                }

                NavigationLink {
                    UsersView()
                } label: {
                    Label("Users", systemImage: "person.2")
                }

                NavigationLink {
                    NotificationsSettingsView()
                } label: {
                    Label("Notifications", systemImage: "bell")
                }
            }
            .listRowBackground(Theme.raised)

            Section("Downloads") {
                Picker("Download over", selection: $downloadOver) {
                    Text("Any").tag("any")
                    Text("Wi-Fi").tag("wifi")
                }
                .pickerStyle(.segmented)

                Button("Delete Downloads", role: .destructive) {
                    model.deleteDownloads()
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
                    model.logout()
                }
            }
            .listRowBackground(Theme.raised)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadAccount()
            await loadVersion()
        }
    }

    private func displayName(for user: SessionUser) -> String? {
        let composedName = [user.firstName, user.lastName]
            .compactMap { $0 }
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
