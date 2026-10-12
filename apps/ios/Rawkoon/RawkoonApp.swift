import SwiftUI

@main
struct RawkoonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate

    init() {
        Appearance.apply()
    }

    var body: some Scene {
        // Depends on nothing, so SwiftUI never re-runs it off the main thread (see AppRootView).
        WindowGroup {
            AppRootView(model: AppModel.shared)
        }
        .commands { RawkoonCommands(model: AppModel.shared) }
    }
}
