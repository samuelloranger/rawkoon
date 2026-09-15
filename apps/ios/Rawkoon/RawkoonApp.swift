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
            .onAppear { configureCatalystTitlebar() }
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .active:
                    configureCatalystTitlebar()
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
            // Outermost on purpose: overlays, alerts, and sheets inherit AppModel.
            // `tabViewBottomAccessory` is a system-hosted tree that does NOT
            // inherit — pass the model explicitly there (see MiniPlayerView).
            // CI greps this file so `.environment(model)` stays below `.overlay`/`.sheet`.
            .environment(model)
        }
    }

    /// Mac Catalyst shows the app name as the window title by default. Hide the
    /// titlebar text (and its empty toolbar) so the window chrome stays clean —
    /// the sidebar already carries the Rawkoon lockup.
    private func configureCatalystTitlebar() {
        #if targetEnvironment(macCatalyst)
            for scene in UIApplication.shared.connectedScenes {
                guard let windowScene = scene as? UIWindowScene,
                      let titlebar = windowScene.titlebar else { continue }
                titlebar.titleVisibility = .hidden
                titlebar.toolbar = nil
            }
        #endif
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

/// Resolves a tab selection against the tabs actually present. `home` only
/// exists for admins, so a role change can leave `selection` pointing at a
/// removed tab; iOS 27 requires the selected value stay visible. Validated in
/// the `TabView(selection:)` getter so it holds during render, not after.
enum RootTabSelection {
    nonisolated static func validated(_ selected: String, isAdmin: Bool) -> String {
        switch selected {
        case "home": isAdmin ? "home" : "library"
        case "discover", "explore", "library", "books", "activity", "settings": selected
        default: "library"
        }
    }
}

private struct RootTabsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var hSizeClass
    @State private var showFullPlayer = false
    @State private var selection: String
    /// The zoom namespace lives on a real View, not the App struct: `@Namespace`
    /// only participates in the view hierarchy when declared on a View, so an
    /// App-level one leaves the source/destination transitions inert.
    @Namespace private var zoomNamespace

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
            .environment(\.rawkoonZoomNamespace, zoomNamespace)
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
            case "qualityProfileEditor": NavigationStack { DebugFirstQualityProfile() }
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
        // Getter resolves against the current admin state so a removed Home tab
        // can't stay selected mid-render; setter stores the raw pick.
        let validSelection = Binding(
            get: { RootTabSelection.validated(selection, isAdmin: model.isAdmin) },
            set: { selection = $0 }
        )
        return TabView(selection: validSelection) {
            if model.isAdmin {
                Tab("Home", systemImage: "house", value: "home") {
                    NavigationStack {
                        HomeView()
                    }
                }
                .customizationID("tab.home")
            }

            // Library comes first. On Mac/iPad it splits into separate Movies &
            // Shows and Books pages; phone keeps one Library tab with a toggle.
            if hSizeClass == .regular {
                Tab("Movies & Shows", systemImage: "film.stack", value: "library") {
                    NavigationStack {
                        LibraryView(forcedSection: .media)
                    }
                }
                .customizationID("tab.library")

                Tab("Books", systemImage: "books.vertical", value: "books") {
                    NavigationStack {
                        LibraryView(forcedSection: .books)
                    }
                }
                .customizationID("tab.books")
            } else {
                Tab("Library", systemImage: "square.stack", value: "library") {
                    NavigationStack {
                        LibraryView()
                    }
                }
                .customizationID("tab.library")
            }

            // On Mac/iPad the swipe deck and Explore grid are separate pages;
            // on phone one "Discover" tab holds the deck (Explore is a sheet).
            Tab(hSizeClass == .regular ? "For You" : "Discover",
                systemImage: "sparkles.rectangle.stack", value: "discover") {
                NavigationStack {
                    DiscoverView()
                }
            }
            .customizationID("tab.discover")

            if hSizeClass == .regular {
                Tab("Explore", systemImage: "square.grid.2x2", value: "explore") {
                    NavigationStack {
                        ExploreView(embedded: true)
                    }
                }
                .customizationID("tab.explore")
            }

            Tab("Activity", systemImage: "arrow.down.circle", value: "activity") {
                NavigationStack {
                    ActivityView()
                }
            }
            .customizationID("tab.activity")

            Tab("Settings", systemImage: "gearshape", value: "settings") {
                NavigationStack {
                    SettingsView()
                }
            }
            .customizationID("tab.settings")
        }
        .tabViewStyle(.sidebarAdaptable)
        // Sidebar-only brand header (iPad/Mac); the phone tab bar never shows it.
        .tabViewSidebarHeader { RawkoonSidebarHeader() }
        .tint(Theme.apricot)
        .miniPlayerAccessory(model: model, onExpand: { showFullPlayer = true })
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

/// Brand lockup shown at the top of the adaptive sidebar (iPad, Mac). Matches
/// the login lockup: the app mark plus the Fraunces wordmark.
private struct RawkoonSidebarHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            Image("AppLogo")
                .resizable()
                .frame(width: 28, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 7))
            Text("Rawkoon")
                .font(.display(22, weight: .semibold))
                .foregroundStyle(Theme.textStrong)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

private extension View {
    /// The accessory modifier is applied UNCONDITIONALLY and toggled with
    /// `isEnabled`. Wrapping `tabViewBottomAccessory` in an `if active` changes
    /// the TabView's view identity when a book starts or stops, so SwiftUI
    /// rebuilds the whole TabView — resetting the navigation stack and snapping
    /// the selection back to the default tab. But an always-present accessory
    /// with empty content leaves a ghost capsule above the tab bar. The
    /// `isEnabled:` overload (iOS 26.2+) is the fix: the modifier stays applied
    /// (no rebuild) while the accessory is hidden when no book is active (no
    /// ghost).
    ///
    /// The accessory content is hosted in a tree detached from the `WindowGroup`,
    /// which does not propagate its environment — so `MiniPlayerView` takes the
    /// model as an explicit argument rather than via `@Environment`, which
    /// trapped on the missing value even when injected here.
    func miniPlayerAccessory(model: AppModel, onExpand: @escaping () -> Void) -> some View {
        tabViewBottomAccessory(isEnabled: model.activeBook() != nil) {
            MiniPlayerView(model: model, onExpand: onExpand)
        }
    }
}
