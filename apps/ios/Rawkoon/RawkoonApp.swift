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
            .task {
                #if DEBUG
                await model.debugAutologinIfNeeded()
                #endif
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
    @State private var selection: Int

    init() {
        var initial = 0
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["RAWKOON_TAB"], let value = Int(raw) {
            initial = value
        }
        #endif
        _selection = State(initialValue: initial)
    }

    var body: some View {
        content
    }

    @ViewBuilder private var content: some View {
        #if DEBUG
        if let screen = DebugScreen.requested {
            debugRoot(screen)
        } else {
            mainTabs
        }
        #else
        mainTabs
        #endif
    }

    #if DEBUG
    @ViewBuilder private func debugRoot(_ screen: String) -> some View {
        switch screen {
        case "movieDetail": DebugFirstDetail(libraryType: "movie")
        case "showDetail": DebugFirstDetail(libraryType: "show")
        case "releaseSearch": DebugFirstReleaseSearch()
        default: mainTabs
        }
    }
    #endif

    private var mainTabs: some View {
        TabView(selection: $selection) {
            NavigationStack {
                DiscoverView()
            }
            .tabItem {
                Label("Discover", systemImage: "sparkles.rectangle.stack")
            }
            .tag(0)

            NavigationStack {
                LibraryView()
            }
            .tabItem {
                Label("Library", systemImage: "square.stack")
            }
            .tag(1)

            NavigationStack {
                ActivityView()
            }
            .tabItem {
                Label("Activity", systemImage: "arrow.down.circle")
            }
            .tag(2)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag(3)
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
