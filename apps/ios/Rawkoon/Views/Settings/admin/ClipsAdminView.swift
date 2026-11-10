import RawkoonKit
import SwiftUI

/// Settings → System → Preview clips: switch, backfill progress, retry, delete all.
struct ClipsAdminView: View {
    @Environment(AppModel.self) var model
    @Environment(\.isActiveRootTab) var isActiveRootTab

    @State var progress: ClipProgress?
    @State var loading = true
    @State var loadError: String?
    @State var hasLoaded = false
    @State var confirmDelete = false

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            } else {
                content
            }
        }
        .navigationTitle("Preview clips")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await reloadAll() } }) {
                if let progress {
                    controlSection(progress)
                    statsSection(progress)
                    if let running = progress.running {
                        runningSection(running, eta: progress.etaSeconds)
                    }
                    if !progress.failedItems.isEmpty {
                        failuresSection(progress)
                    }
                    deleteSection(progress)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        // Tabs stay mounted on iPhone, so stop polling when this tab isn't the visible one,
        // and while offline, where every poll would fail.
        .task(id: isActiveRootTab && !model.isOffline) {
            guard isActiveRootTab else { return }
            guard !model.isOffline else {
                if !hasLoaded {
                    loadError = settingsErrorMessage(APIError.offline)
                    loading = false
                }
                return
            }
            await pollLoop()
        }
        .rawkoonConfirm("Delete all clips?", isPresented: $confirmDelete) {
            Button("Delete all clips", role: .destructive) { Task { await deleteAll() } }
        } message: {
            Text("This frees \(Formatters.bytesEcho(String(progress?.totalBytes ?? 0))). Clips are cut again if you turn them back on. Your library files are not touched.")
        }
    }

    private func controlSection(_ p: ClipProgress) -> some View {
        Section {
            Toggle("Preview clips", isOn: Binding(
                get: { p.settings.enabled },
                set: { value in Task { await patch(ClipSettingsPatch(enabled: value)) } }
            ))
            .requiresConnection(model.isOffline)
            .listRowBackground(Theme.raised)
            if p.settings.enabled {
                Button(p.settings.paused ? LocalizedStringKey("Resume") : LocalizedStringKey("Pause")) {
                    Task { await patch(ClipSettingsPatch(paused: !p.settings.paused)) }
                }
                .requiresConnection(model.isOffline)
                .listRowBackground(Theme.raised)
            }
        } footer: {
            Text("Cuts a short silent clip for each movie and season, shown behind the title on the TV.")
        }
    }

    private func statsSection(_ p: ClipProgress) -> some View {
        Section("Progress") {
            LabeledContent("Done", value: String(p.done))
            LabeledContent("Left", value: String(p.left))
            LabeledContent("Failed", value: String(p.failed))
            LabeledContent("Size on disk", value: Formatters.bytesEcho(String(p.totalBytes)))
        }
        .listRowBackground(Theme.raised)
    }

    private func runningSection(_ item: ClipRunningItem, eta: Int?) -> some View {
        Section("Cutting now") {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: ClipsDisplay.itemLabel(title: item.title, seasonNumber: item.seasonNumber))
                    .foregroundStyle(Theme.textStrong)
                if let eta, let left = Formatters.durationCompact(Double(eta)) {
                    Text("~\(left) left").font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .listRowBackground(Theme.raised)
        }
    }

    private func failuresSection(_ p: ClipProgress) -> some View {
        Section("Recent failures") {
            ForEach(p.failedItems) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: ClipsDisplay.itemLabel(title: item.title, seasonNumber: item.seasonNumber))
                        .foregroundStyle(Theme.text)
                    if let error = item.error {
                        Text(verbatim: error).font(.footnote).foregroundStyle(Theme.muted)
                    }
                }
                .listRowBackground(Theme.raised)
            }
            Button("Retry failed") { Task { await retryFailed() } }
                .requiresConnection(model.isOffline)
                .listRowBackground(Theme.raised)
        }
    }

    private func deleteSection(_ p: ClipProgress) -> some View {
        let allowed = ClipsDisplay.canDeleteAll(enabled: p.settings.enabled, doneCount: p.done, totalBytes: p.totalBytes)
        return Section {
            Button("Delete all clips", role: .destructive) { confirmDelete = true }
                .disabled(!allowed)
                .requiresConnection(model.isOffline)
                .listRowBackground(Theme.raised)
        } footer: {
            if p.settings.enabled {
                Text("Turn preview clips off to delete them.")
            }
        }
    }

    // MARK: Loading and actions

    private func pollLoop() async {
        await reloadAll()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(progress?.running == nil ? 10 : 2))
            guard !Task.isCancelled else { return }
            await refreshQuietly()
        }
    }

    private func reloadAll() async {
        guard let client = model.api() else { loading = false; return }
        do {
            progress = try await client.clipProgress()
            loadError = nil
            hasLoaded = true
        } catch {
            if !hasLoaded {
                loadError = settingsErrorMessage(error)
            }
        }
        loading = false
    }

    /// Refresh without replacing the screen with an error view on a transient failure.
    private func refreshQuietly() async {
        guard let client = model.api() else { return }
        if let p = try? await client.clipProgress() {
            progress = p
            // A later poll that succeeds replaces a first-load error
            loadError = nil
            hasLoaded = true
            loading = false
        }
    }

    private func patch(_ changes: ClipSettingsPatch) async {
        guard let client = model.api() else { return }
        do {
            _ = try await client.updateClipSettings(changes)
        } catch {
            // 409 carries the storage guard's reason.
            model.toast(settingsErrorMessage(error), style: .error)
        }
        await refreshQuietly()
    }

    private func retryFailed() async {
        guard let client = model.api() else { return }
        do {
            _ = try await client.retryFailedClips()
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
        await refreshQuietly()
    }

    private func deleteAll() async {
        guard let client = model.api() else { return }
        do {
            _ = try await client.deleteAllClips()
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
        await refreshQuietly()
    }
}
