import SwiftUI

/// GitHub releases (admin, read-only + refresh). `GET /api/releases`,
/// `POST /api/releases/refresh`.
struct ReleasesAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var releases: [GithubReleaseDTO] = []
    @State private var sync: ReleaseSyncDTO?
    @State private var loading = true
    @State private var loadError: String?
    @State private var refreshing = false

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                content
            }
        }
        .navigationTitle("Releases")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if let sync {
                    Section {
                        if let repo = sync.repoFullName {
                            LabeledContent("Repo") { Text(repo).foregroundStyle(Theme.muted) }
                                .listRowBackground(Theme.raised)
                        }
                        if let error = sync.lastError {
                            Text(error).font(.footnote).foregroundStyle(Theme.terracotta)
                                .listRowBackground(Theme.raised)
                        }
                    }
                }
                ForEach(releases) { release in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(release.name ?? release.tagName).foregroundStyle(Theme.text)
                        Text(release.tagName).font(.footnote).foregroundStyle(Theme.muted)
                    }
                    .listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if refreshing {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Refresh") { Task { await refresh() } }
                }
            }
        }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let response = try await client.releases()
            releases = response.releases
            sync = response.sync
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func refresh() async {
        guard let client = model.api() else { return }
        refreshing = true
        do {
            try await client.refreshReleases()
            model.toast("Releases refreshed.", style: .success)
        } catch {
            model.toast("Couldn't refresh releases.", style: .error)
        }
        await load()
        refreshing = false
    }
}

/// Scheduled jobs (admin): trigger the fixed maintenance actions manually.
struct JobsAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var running: String?
    @State private var message: String?

    private static let actions: [(action: String, label: String)] = [
        ("cleanup_notifications", "Clean up notifications"),
        ("refresh_upcoming", "Refresh upcoming"),
        ("check_movie_release_reminders", "Check movie release reminders"),
        ("check_library_movie_releases", "Check library movie releases"),
        ("check_library_episode_releases", "Check library episode releases"),
        ("sync_library_show_episodes", "Sync show episodes"),
        ("check_library_download_completion", "Check download completion"),
        ("sync_library_attention_alerts", "Sync attention alerts"),
        ("check_library_integrity", "Check library integrity"),
        ("refresh_github_releases", "Refresh GitHub releases"),
    ]

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                content
            }
        }
        .navigationTitle("Jobs")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            Section {
                ForEach(Self.actions, id: \.action) { item in
                    Button { Task { await run(item.action) } } label: {
                        HStack {
                            Text(item.label).foregroundStyle(Theme.text)
                            Spacer()
                            if running == item.action {
                                ProgressView().tint(Theme.apricot)
                            } else {
                                Image(systemName: "play.circle").foregroundStyle(Theme.apricot)
                            }
                        }
                    }
                    .disabled(running != nil)
                    .listRowBackground(Theme.raised)
                }
            } header: {
                Text("Run a job now")
            } footer: {
                if let message {
                    Text(message).foregroundStyle(Theme.muted)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
    }

    private func run(_ action: String) async {
        guard let client = model.api() else { return }
        running = action; message = nil
        do {
            try await client.triggerJobAction(action)
            message = "Started."
        } catch {
            message = "Couldn't start the job."
        }
        running = nil
    }
}
