import SwiftUI
import UIKit

@main
struct RawkoonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = AppModel()

    init() {
        Appearance.apply()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if model.isLoggedIn {
                    RootTabsView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(model)
            .tint(Theme.apricot)
            .preferredColorScheme(.dark)
            .onAppear {
                delegate.appModel = model
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    weak var appModel: AppModel?

    func application(_ application: UIApplication,
                     handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            guard let appModel else {
                completionHandler()
                return
            }
            appModel.handleBackgroundEvents(identifier: identifier, completionHandler: completionHandler)
        }
    }
}

private struct RootTabsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView {
            NavigationStack {
                LibraryView()
            }
            .tabItem {
                Label("Library", systemImage: "books.vertical")
            }

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
        }
        .tint(Theme.apricot)
        .task {
            if model.library.isEmpty {
                await model.loadLibrary()
            }
        }
    }
}
