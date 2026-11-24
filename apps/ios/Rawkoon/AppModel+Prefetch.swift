import BackgroundTasks
import Foundation
import RawkoonKit
import UIKit

/// A background refresh keeps the main screens current between launches; the
/// offline prefetch it triggers lives in `DownloadsStore`.
extension AppModel {
    static let backgroundRefreshIdentifier = "cloud.samlo.rawkoon.refresh"

    // MARK: Background refresh

    /// Registered before launch finishes, as BGTaskScheduler requires. The main
    /// queue keeps the handler on the actor this module defaults to.
    static func registerBackgroundRefresh() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: backgroundRefreshIdentifier, using: .main) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            MainActor.assumeIsolated {
                AppModel.shared.handleBackgroundRefresh(refresh)
            }
        }
    }

    /// Asks for the next refresh a few hours out; iOS picks the actual time.
    func scheduleBackgroundRefresh() {
        guard isLoggedIn else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundRefreshIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 3600)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            Log.sync.debug("background refresh not scheduled: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func handleBackgroundRefresh(_ task: BGAppRefreshTask) {
        scheduleBackgroundRefresh()
        let work = Task { @MainActor in
            await refreshSavedData()
            await downloads.prefetchForOffline()
        }
        // Called off the main thread; an inferred @MainActor closure would trap.
        task.expirationHandler = { @Sendable in
            work.cancel()
        }
        Task { @MainActor in
            await work.value
            task.setTaskCompleted(success: !work.isCancelled)
        }
    }

    /// Refetches what the main tabs paint first, which rewrites their saved copies.
    func refreshSavedData() async {
        guard isLoggedIn, let apiClient = session.apiClient else { return }
        let widgetGeneration = WidgetSnapshotWriter.shared.generation
        await libraryStore.loadLibrary()
        await session.refreshAdmin()
        async let recent = try? apiClient.get(Endpoints.recentlyAdded())
        async let upcoming = try? apiClient.get(Endpoints.upcoming)
        async let deck = try? apiClient.get(Endpoints.discoverDeck(limit: 12))
        async let grid = try? apiClient.get(Endpoints.libraryList(
            page: 1, limit: 60, sortBy: "added_at", sortDir: "desc"
        ))
        async let progress = try? apiClient.getProgress()
        async let reading = try? apiClient.readingProgress()
        async let notifications = try? apiClient.get(Endpoints.notifications(page: 1, limit: 25))
        let (recentResult, _, deckResult, _, _, _, _) = await (
            recent, upcoming, deck, grid, progress, reading, notifications
        )
        if let items = recentResult?.items {
            await WidgetSnapshotWriter.shared.updateRecent(items, model: self)
        }
        if let deckResult {
            await WidgetSnapshotWriter.shared.updateSuggestion(deckResult, model: self)
        }
        await WidgetSnapshotWriter.shared.updateWatch(model: self)
        if let features = try? await apiClient.systemFeatures() {
            let listening = features.booksEnabled ? try? await apiClient.listeningStats() : nil
            WidgetSnapshotWriter.shared.updateListening(listening, ifGeneration: widgetGeneration)
        }
        await refreshUnreadNotificationCount()
    }
}
