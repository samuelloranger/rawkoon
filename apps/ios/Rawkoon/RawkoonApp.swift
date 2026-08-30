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
    @State private var showFullPlayer = false

    var body: some View {
        TabView {
            NavigationStack {
                DiscoverView()
            }
            .tabItem {
                Label("Discover", systemImage: "sparkles.rectangle.stack")
            }

            NavigationStack {
                LibraryView()
            }
            .tabItem {
                Label("Library", systemImage: "square.stack")
            }

            NavigationStack {
                ActivityView()
            }
            .tabItem {
                Label("Activity", systemImage: "arrow.down.circle")
            }

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
        }
        .tint(Theme.apricot)
        .safeAreaInset(edge: .bottom) {
            MiniPlayerView { showFullPlayer = true }
        }
        .sheet(isPresented: $showFullPlayer) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environmentObject(model)
            }
        }
        .task {
            if model.library.isEmpty {
                await model.loadLibrary()
            }
        }
    }
}
