import SwiftUI
import UIKit

@main
struct RawkoonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Appearance.apply()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                    if let screen = DebugScreen.requested, DebugScreen.isOffline(screen) {
                        DebugScreen.offlineView(for: screen)
                    } else if model.isLoggedIn {
                        RootTabsView()
                    } else {
                        LoginView()
                    }
                #else
                    if model.isLoggedIn {
                        RootTabsView()
                    } else {
                        LoginView()
                    }
                #endif
            }
            .environment(model)
            .tint(Theme.apricot)
            .preferredColorScheme(.dark)
            .overlay {
                ToastOverlay(toast: model.currentToast)
            }
            .alert(
                "Login not saved",
                isPresented: Binding(
                    get: { model.authWarning != nil },
                    set: {
                        if !$0 {
                            model.authWarning = nil
                        }
                    }
                )
            ) {
                Button("OK", role: .cancel) { model.authWarning = nil }
            } message: {
                if let warning = model.authWarning {
                    Text(warning)
                }
            }
            // Live notification banner (spec T4) — foreground-only, so it sits
            // above whichever tab is showing rather than inside one NavigationStack.
            .overlay(alignment: .top) {
                if let notification = model.bannerNotification {
                    NotificationBannerView(notification: notification)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .rawkoonMotion(RawkoonMotion.spring, value: model.bannerNotification?.id)
                }
            }
            // A notification's resolved destination (spec T6) is shown modally
            // from the app root so a banner tap works no matter which tab is
            // active; the list itself also navigates here for the same reason.
            .sheet(item: Binding(
                get: { model.deepLinkTarget },
                set: { model.deepLinkTarget = $0 }
            )) { destination in
                NavigationStack {
                    NotificationDestinationView(destination: destination)
                        .environment(model)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { model.deepLinkTarget = nil }
                            }
                        }
                }
            }
            .task {
                #if DEBUG
                    await model.debugAutologinIfNeeded()
                    await model.debugStartDownloadIfRequested()
                #endif
                if model.isLoggedIn {
                    model.requestPushAuthorization()
                    model.startLiveStreams()
                    await model.refreshUnreadNotificationCount()
                }
            }
            // `.inactive` (a brief transitional state — Control Center, a system
            // alert) intentionally does nothing here; only a real background
            // transition tears the streams down.
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .active:
                    model.startLiveStreams()
                    Task { await model.refreshUnreadNotificationCount() }
                case .background:
                    model.stopLiveStreams()
                case .inactive:
                    break
                @unknown default:
                    break
                }
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Resolved at launch rather than from a view's onAppear: a background launch
    /// for finished downloads may never render anything.
    @MainActor private var appModel: AppModel {
        AppModel.shared
    }

    func application(_: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data)
    {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            appModel.handleApnsToken(token)
        }
    }

    func application(_: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError _: Error)
    {
        // Registration can fail in the simulator or without a provisioning
        // profile that includes the push entitlement — non-fatal.
    }

    func application(_: UIApplication,
                     handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void)
    {
        Task { @MainActor in
            appModel.handleBackgroundEvents(identifier: identifier, completionHandler: completionHandler)
        }
    }
}

private struct RootTabsView: View {
    @Environment(AppModel.self) private var model
    @State private var showFullPlayer = false
    @State private var selection: String

    init() {
        // Library is the household default. Admins are moved to Home in `.task`
        // once `isAdmin` is known. Debug `RAWKOON_TAB` still wins.
        var initial = "library"
        #if DEBUG
            if let raw = ProcessInfo.processInfo.environment["RAWKOON_TAB"], let value = Int(raw) {
                let tags = ["home", "discover", "library", "activity", "settings"]
                if tags.indices.contains(value) {
                    initial = tags[value]
                }
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
            case "home": NavigationStack { HomeView() }
            case "book": DebugFirstBook()
            case "playerReal": DebugRealPlayer()
            case "miniPlayer": DebugMiniPlayer { mainTabs }
            case "reader": DebugEbookReader()
            case "settings": NavigationStack { SettingsView() }
            case "requests": NavigationStack { RequestsView() }
            case "qualityProfiles": NavigationStack { QualityProfilesView() }
            case "notifications": NavigationStack { NotificationsSettingsView() }
            case "indexers": NavigationStack { IndexersView() }
            case "users": NavigationStack { UsersView() }
            case "downloadClient": NavigationStack { DownloadClientView() }
            case "explore": NavigationStack { ExploreView() }
            default: mainTabs
            }
        }
    #endif

    private var mainTabs: some View {
        TabView(selection: $selection) {
            if model.isAdmin {
                Tab("Home", systemImage: "house", value: "home") {
                    NavigationStack {
                        HomeView()
                    }
                    .modifier(MiniPlayerContentInset(onExpand: { showFullPlayer = true }))
                }
                .customizationID("tab.home")
            }

            Tab("Discover", systemImage: "sparkles.rectangle.stack", value: "discover") {
                NavigationStack {
                    DiscoverView()
                }
                .modifier(MiniPlayerContentInset(onExpand: { showFullPlayer = true }))
            }
            .customizationID("tab.discover")

            Tab("Library", systemImage: "square.stack", value: "library") {
                NavigationStack {
                    LibraryView()
                }
                .modifier(MiniPlayerContentInset(onExpand: { showFullPlayer = true }))
            }
            .customizationID("tab.library")

            Tab("Activity", systemImage: "arrow.down.circle", value: "activity") {
                NavigationStack {
                    ActivityView()
                }
                .modifier(MiniPlayerContentInset(onExpand: { showFullPlayer = true }))
            }
            .customizationID("tab.activity")

            Tab("Settings", systemImage: "gearshape", value: "settings") {
                NavigationStack {
                    SettingsView()
                }
                .modifier(MiniPlayerContentInset(onExpand: { showFullPlayer = true }))
            }
            .customizationID("tab.settings")
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(Theme.apricot)
        .miniPlayerAccessory(active: model.activeBook() != nil, onExpand: { showFullPlayer = true })
        .alert(
            "Couldn't play chapter",
            isPresented: Binding(
                get: { model.player.playbackError != nil },
                set: {
                    if !$0 {
                        model.player.clearPlaybackError()
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) { model.player.clearPlaybackError() }
        } message: {
            if let message = model.player.playbackError {
                Text(message)
            }
        }
        .sheet(isPresented: $showFullPlayer) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environment(model)
            }
        }
        .task {
            #if DEBUG
                let debugTabLocked = ProcessInfo.processInfo.environment["RAWKOON_TAB"] != nil
            #else
                let debugTabLocked = false
            #endif
            if model.library.isEmpty {
                await model.loadLibrary()
            }
            // `isAdmin` is false until refreshAdmin runs inside loadLibrary.
            if !debugTabLocked, model.isAdmin, selection == "library" {
                selection = "home"
            }
        }
    }
}

private extension View {
    /// `tabViewBottomAccessory` is iOS 26+; the app's deployment target is 18,
    /// so pre-26 devices get the mini player from `MiniPlayerContentInset`
    /// instead (applied per-tab, not here — see that type's doc comment).
    ///
    /// `active` gates whether the accessory is attached at all: the system
    /// reserves the accessory's slot as soon as `tabViewBottomAccessory` is
    /// present, even if `MiniPlayerView`'s own content is empty, so an idle
    /// (no active book) state must skip attaching it rather than render an
    /// empty accessory. `chromed: false` hands the system its own framing —
    /// `MiniPlayerView`'s floating-pill chrome is for the iOS 18 fallback only.
    @ViewBuilder
    func miniPlayerAccessory(active: Bool, onExpand: @escaping () -> Void) -> some View {
        if #available(iOS 26.0, *), active {
            tabViewBottomAccessory {
                MiniPlayerView(onExpand: onExpand, chromed: false)
            }
        } else {
            self
        }
    }
}

/// Insets a single tab's content above the tab bar with the mini player, for
/// iOS versions before `tabViewBottomAccessory` (iOS 26) exists.
///
/// A `.safeAreaInset(edge: .bottom)` applied to the `TabView` itself lays the
/// bar out against the bottom of the whole tab view, so it sits on top of the
/// tab bar. Insetting each tab's content keeps it just above the tab bar and
/// leaves the tab items tappable. On iOS 26+ this is a no-op: the accessory
/// slot (`miniPlayerAccessory`, applied to the `TabView`) already places it,
/// and inset here too would double it up.
private struct MiniPlayerContentInset: ViewModifier {
    let onExpand: () -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
        } else {
            content.safeAreaInset(edge: .bottom) {
                MiniPlayerView(onExpand: onExpand)
            }
        }
    }
}
