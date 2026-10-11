import Foundation
import RawkoonKit
import UIKit
import UserNotifications

extension AppModel {
    /// Passthroughs to `liveUpdates`, preserving AppModel's prior public surface.
    /// All are read-only here; the coordinator owns every write.
    var libraryChangeToken: Int {
        liveUpdates.libraryChangeToken
    }

    var bookChangeToken: Int {
        liveUpdates.bookChangeToken
    }

    var notificationChangeToken: Int {
        liveUpdates.notificationChangeToken
    }

    var downloadProgress: [Int: [Int: LiveDownload]] {
        liveUpdates.downloadProgress
    }

    var unreadNotificationCount: Int {
        liveUpdates.unreadNotificationCount
    }

    var bannerNotification: StreamNotificationDTO? {
        liveUpdates.bannerNotification
    }

    var libraryStreamStatus: SSEStreamStatus {
        liveUpdates.libraryStreamStatus
    }

    var notificationStreamStatus: SSEStreamStatus {
        liveUpdates.notificationStreamStatus
    }

    var sseDebugLog: [SSEDebugLogEntry] {
        liveUpdates.sseDebugLog
    }

    /// Forces both SSE connections closed and immediately reopens them — see
    /// `LiveUpdatesCoordinator.forceReconnect`.
    func forceReconnectSSE() {
        liveUpdates.forceReconnect()
    }

    // MARK: Live updates (spec §T2/T4)

    /// Starts the library-events and notification SSE consumers — see
    /// `LiveUpdatesCoordinator.start`. Call when the app becomes active while
    /// signed in (see `RawkoonApp`'s `scenePhase` handling).
    func startLiveStreams() {
        liveUpdates.start()
    }

    /// Stops both live streams. Call on background/logout.
    func stopLiveStreams() {
        liveUpdates.stop()
    }

    /// Dismisses the in-app notification banner early (e.g. on tap).
    func dismissBanner() {
        liveUpdates.dismissBanner()
    }

    func holdBanner() {
        liveUpdates.holdBanner()
    }

    func releaseBanner() {
        liveUpdates.releaseBanner()
    }

    /// Resolves a notification's `url` to a native destination and pushes it.
    func navigate(toNotificationUrl url: String?) {
        liveUpdates.navigate(toNotificationUrl: url)
    }

    /// Best-effort unread-count refresh — called after sign-in and whenever
    /// `NotificationsListView` changes read state server-side.
    func refreshUnreadNotificationCount() async {
        await liveUpdates.refreshUnreadCount()
    }

    /// Launch and sign-in only re-register a device the user already allowed;
    /// the prompt waits for a request or the notification settings (HIG).
    func registerForPushIfAuthorized() {
        Task {
            let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
            if status == .authorized || status == .provisional || status == .ephemeral {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Ask for notification permission, then register for remote notifications.
    /// Safe to call repeatedly — the system won't re-prompt once decided.
    func requestPushAuthorization() {
        #if DEBUG
            // Skip the permission prompt when screenshotting an offline debug
            // screen — the dialog would cover the view under review.
            if let screen = DebugScreen.requested, DebugScreen.isOffline(screen) {
                return
            }
            if ProcessInfo.processInfo.environment["RAWKOON_SCREENSHOT"] == "1" {
                return
            }
        #endif
        Task {
            let center = UNUserNotificationCenter.current()
            let granted = await (try? center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Called from the app delegate with the hex device token.
    func handleApnsToken(_ token: String) {
        pendingApnsToken = token
        Task { await registerApnsIfPossible() }
    }

    private func registerApnsIfPossible() async {
        guard let token = pendingApnsToken, let apiClient else { return }
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        try? await apiClient.registerApns(
            deviceToken: token,
            deviceName: UIDevice.current.name,
            osVersion: UIDevice.current.systemVersion,
            appVersion: appVersion,
            bundleId: Bundle.main.bundleIdentifier
        )
        registeredApnsToken = token
        pendingApnsToken = nil
    }
}
