import SwiftUI

/// One admin group's rows, pushed from its summary row on the phone.
struct SettingsGroupView: View {
    let group: SettingsGroup

    var body: some View {
        Form {
            Section {
                ForEach(group.destinations) { destination in
                    NavigationLink {
                        destination.destination
                    } label: {
                        Label(destination.title, systemImage: destination.systemImage)
                    }
                }
            }
            .listRowBackground(Theme.raised)
        }
        .settingsScreenStyle()
        .navigationTitle(group.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Push alerts, the devices that receive them, and the outbound channels.
struct SettingsAlertsView: View {
    var body: some View {
        Form {
            Section {
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
        }
        .settingsScreenStyle()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SettingsPlaybackView: View {
    @AppStorage("download_over") private var downloadOver = "any"
    @AppStorage("smart_rewind") private var smartRewind = false

    var body: some View {
        Form {
            Section {
                Toggle("Smart rewind", isOn: $smartRewind)
            } header: {
                Text("Playback")
            } footer: {
                Text("Rewind when a book resumes, by how long it was paused \u{2014} nothing under three seconds, three under fifteen, six under five minutes, ten under an hour, twenty overnight.")
            }
            .listRowBackground(Theme.raised)

            // A Mac has no cellular link to restrict.
            #if !targetEnvironment(macCatalyst)
                Section("Downloads") {
                    Picker("Download over", selection: $downloadOver) {
                        Text("Any").tag("any")
                        Text("Wi-Fi").tag("wifi")
                    }
                    .pickerStyle(.segmented)
                }
                .listRowBackground(Theme.raised)
            #endif
        }
        .settingsScreenStyle()
        .navigationTitle("Playback & downloads")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// What the app keeps on this device, with the two ways to free it.
struct SettingsStorageView: View {
    @Environment(AppModel.self) private var model
    @State private var savedDataBytes = 0
    @State private var confirmDeleteDownloads = false
    @State private var confirmClearSavedData = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Saved data") {
                    Text(ByteCountFormatter.string(fromByteCount: Int64(savedDataBytes), countStyle: .file))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
                if let synced = model.libraryFetchedAt {
                    LabeledContent("Last synced") {
                        Text(synced, style: .relative)
                            .font(.caption)
                            .foregroundStyle(Theme.faint)
                    }
                }
            } header: {
                Text("Offline")
            } footer: {
                Text("Screens you've opened, and recent titles fetched ahead of time on Wi-Fi, stay viewable without a connection.")
            }
            .listRowBackground(Theme.raised)

            Section {
                Button("Clear Saved Data", role: .destructive) {
                    confirmClearSavedData = true
                }
                Button("Delete Downloads", role: .destructive) {
                    confirmDeleteDownloads = true
                }
            }
            .listRowBackground(Theme.raised)
        }
        .settingsScreenStyle()
        .navigationTitle("Storage")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { savedDataBytes = model.savedDataBytes }
        .rawkoonConfirm(
            "Delete downloaded chapters?",
            isPresented: $confirmDeleteDownloads
        ) {
            Button("Delete Downloads", role: .destructive) {
                model.deleteDownloads()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes offline audiobook chapters from this iPhone. Playback will need the network until they download again.")
        }
        .rawkoonConfirm(
            "Clear saved data?",
            isPresented: $confirmClearSavedData
        ) {
            Button("Clear Saved Data", role: .destructive) {
                model.clearSavedData()
                savedDataBytes = model.savedDataBytes
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Screens will need the network again until they reload. Downloads and your sign-in are kept.")
        }
    }
}

/// Who is signed in, to which server, and the way out.
struct SettingsAccountView: View {
    let name: String?
    let email: String?
    let version: String?

    @Environment(AppModel.self) private var model
    @State private var confirmLogOut = false

    var body: some View {
        Form {
            Section {
                VStack(spacing: 6) {
                    SettingsAvatar(initials: model.userInitials, size: 76)
                        .padding(.bottom, 6)
                    if let name, !name.isEmpty {
                        Text(verbatim: name)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Theme.textStrong)
                    }
                    if let email, !email.isEmpty {
                        Text(verbatim: email)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .listRowBackground(Color.clear)

            Section {
                NavigationLink {
                    ProfileView()
                } label: {
                    Label("Edit profile", systemImage: "person.crop.circle")
                }
            }
            .listRowBackground(Theme.raised)

            Section("Server") {
                LabeledContent("Server URL") {
                    Text(verbatim: model.serverURL)
                        .foregroundStyle(Theme.muted)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                LabeledContent("Version") {
                    Text("Rawkoon \(version ?? "—")")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
            .listRowBackground(Theme.raised)

            Section {
                Button(role: .destructive) {
                    confirmLogOut = true
                } label: {
                    Text("Log Out")
                        .frame(maxWidth: .infinity)
                }
            }
            .listRowBackground(Theme.raised)
        }
        .settingsScreenStyle()
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .rawkoonConfirm(
            "Log out of Rawkoon?",
            isPresented: $confirmLogOut
        ) {
            Button("Log Out", role: .destructive) {
                model.logout()
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}
