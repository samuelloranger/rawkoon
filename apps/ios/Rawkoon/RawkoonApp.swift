import SwiftUI

@main
struct RawkoonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Appearance.apply()
    }

    var body: some Scene {
        // Reads no observable state, so SwiftUI never re-runs it off the main thread (see AppRootView).
        WindowGroup {
            AppRootView(model: model)
        }
        // `.inactive` (a brief transitional state — Control Center, a system
        // alert) intentionally does nothing here; only a real background
        // transition tears the streams down.
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                AppRootView.configureCatalystTitlebar()
                model.startLiveStreams()
                model.resyncDownloads()
                Task { await model.refreshUnreadNotificationCount() }
            case .background:
                model.persistPlaybackProgress(force: true)
                model.stopLiveStreams()
                model.scheduleBackgroundRefresh()
            case .inactive:
                break
            @unknown default:
                break
            }
        }
        .commands { RawkoonCommands(model: model) }
    }
}
