import RawkoonKit
import SwiftUI

/// Settings → Jobs & Releases → Re-encode: queue controls, running job, queue, history.
struct ReencodeAdminView: View {
    @Environment(AppModel.self) var model
    @Environment(\.isActiveRootTab) var isActiveRootTab

    @State var active: [TranscodeJob] = []
    @State var history: [TranscodeJob] = []
    @State var settings: TranscodeQueueSettings?
    @State var summary: TranscodeSummary?
    @State var loading = true
    @State var loadError: String?
    @State var hasLoaded = false
    @State var busyIds: Set<Int> = []
    @State var confirmCancel: TranscodeJob?
    @State var confirmClear = false
    @State var confirmFree: TranscodeJob?
    @State var privateUnmet = 0
    @State var confirmDiscard: TranscodeJob?

    var running: TranscodeJob? {
        active.first { $0.status == "running" }
    }

    var queued: [TranscodeJob] {
        active.filter { $0.status == "queued" }
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            } else {
                content
            }
        }
        .navigationTitle("Re-encode")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await reloadAll() } }) {
                statusSection
                overviewSection
                if let running {
                    runningSection(running)
                }
                queueSection
                historySection
                advancedSection
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            if queued.count > 1 {
                ToolbarItem(placement: .primaryAction) { EditButton().requiresConnection(model.isOffline) }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("Clear finished", role: .destructive) { confirmClear = true }
                    .requiresConnection(model.isOffline)
            }
        }
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
        .rawkoonConfirm(
            "Cancel this re-encode?",
            isPresented: Binding(get: { confirmCancel != nil }, set: {
                if !$0 {
                    confirmCancel = nil
                }
            }),
            presenting: confirmCancel
        ) { job in
            Button("Cancel re-encode", role: .destructive) { Task { await cancel(job) } }
        } message: { _ in
            Text("The original file is kept; the partial output is deleted.")
        }
        .rawkoonConfirm(
            "Free the space held by the old file?",
            isPresented: Binding(get: { confirmFree != nil }, set: {
                if !$0 {
                    confirmFree = nil
                }
            }),
            presenting: confirmFree
        ) { job in
            Button("Remove torrent and file", role: .destructive) { Task { await freeSource(job) } }
        } message: { job in
            if privateUnmet > 0 {
                Text("\(privateUnmet) torrent(s) on a private tracker haven't reached their seed target yet. Removing them now can cost ratio or count as a hit-and-run.")
                    + Text(verbatim: "\n\n")
                    + Text("This removes the torrent for \(job.title) from the download client and deletes the old file, so it stops seeding. The re-encoded copy in your library is not touched.")
            } else {
                Text("This removes the torrent for \(job.title) from the download client and deletes the old file, so it stops seeding. The re-encoded copy in your library is not touched.")
            }
        }
        .rawkoonConfirm(
            "Delete this failed re-encode?",
            isPresented: Binding(get: { confirmDiscard != nil }, set: {
                if !$0 {
                    confirmDiscard = nil
                }
            }),
            presenting: confirmDiscard
        ) { job in
            Button("Delete", role: .destructive) { Task { await discard(job) } }
        } message: { job in
            Text("This removes \(job.title) from the history and deletes the partial file it left behind. Your library file is not touched.")
        }
        .rawkoonConfirm("Clear finished jobs?", isPresented: $confirmClear) {
            Button("Clear finished", role: .destructive) { Task { await clearHistory() } }
        }
    }
}
