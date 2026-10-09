import RawkoonKit
import SwiftUI
import UIKit

@main
struct RawkoonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase
    /// In-app UI-language override (see `AppLanguage`). Drives the environment
    /// locale for SwiftUI `Text`, and — via `APIClient` — the language the server
    /// localizes titles/metadata in.
    @AppStorage(AppLanguage.storageKey) private var appLanguage = AppLanguage.system.rawValue

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
            .environment(\.locale, AppLanguage.locale(for: AppLanguage(rawValue: appLanguage) ?? .system))
            .overlay {
                ToastOverlay(toast: model.currentToast, bottomInset: toastBottomInset)
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
                // The animation sits outside the `if` so insertion and removal both animate.
                ZStack {
                    if let notification = model.bannerNotification {
                        NotificationBannerView(notification: notification)
                            .padding(.top, 8)
                            .transition(.rawkoonEdge(.top))
                    }
                }
                .rawkoonMotion(RawkoonMotion.spring, value: model.bannerNotification?.id)
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
                    // Screenshot-only: the simulator can't tap, so show the blocked-action toast directly.
                    if ProcessInfo.processInfo.environment["RAWKOON_DEMO_OFFLINE_TOAST"] == "1" {
                        try? await Task.sleep(for: .seconds(4))
                        OfflineFeedback.explain()
                    }
                #endif
                if model.isLoggedIn {
                    model.registerForPushIfAuthorized()
                    model.startLiveStreams()
                    ReencodeActivityCoordinator.shared.start(model: model)
                    await model.refreshUnreadNotificationCount()
                }
            }
            // `.inactive` (a brief transitional state — Control Center, a system
            // alert) intentionally does nothing here; only a real background
            // transition tears the streams down.
            .onAppear { configureCatalystTitlebar() }
            // Server-localized content (titles, discovery) is language-tagged at
            // request time, so a language change must refetch the library to pull
            // titles in the new locale.
            .onChange(of: appLanguage) {
                guard model.isLoggedIn else { return }
                Task { await model.loadLibrary() }
            }
            .onChange(of: model.isAdmin) { _, isAdmin in
                if isAdmin {
                    ReencodeActivityCoordinator.shared.start(model: model)
                } else {
                    ReencodeActivityCoordinator.shared.stop(model: model)
                }
            }
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .active:
                    configureCatalystTitlebar()
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
            // Outermost on purpose: overlays, alerts, and sheets inherit AppModel.
            // `tabViewBottomAccessory` is a system-hosted tree that does NOT
            // inherit — pass the model explicitly there (see MiniPlayerView).
            // CI greps this file so `.environment(model)` stays below `.overlay`/`.sheet`.
            .environment(model)
        }
        .commands { RawkoonCommands(model: model) }
    }

    /// On iPhone the tab bar floats over the bottom edge, with the mini player
    /// above it while a book is loaded; in the sidebar only the mini player floats.
    private var toastBottomInset: CGFloat {
        guard model.isLoggedIn else { return 12 }
        if UIDevice.current.userInterfaceIdiom != .phone {
            return model.activeBook() == nil ? 12 : 12 + MiniPlayerInset.height
        }
        return model.activeBook() == nil ? 84 : 148
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

final class AppDelegate: UIResponder, UIApplicationDelegate {
    #if targetEnvironment(macCatalyst)
        /// SwiftUI's `CommandGroup(replacing:)` leaves these UIKit menus in place on Catalyst.
        override func buildMenu(with builder: any UIMenuBuilder) {
            super.buildMenu(with: builder)
            guard builder.system == .main else { return }
            builder.remove(menu: .document)
            builder.remove(menu: .help)
        }
    #endif

    /// Resolved at launch rather than from a view's onAppear: a background launch
    /// for finished downloads may never render anything.
    @MainActor private var appModel: AppModel {
        AppModel.shared
    }

    func application(
        _: UIApplication,
        didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        AppModel.registerBackgroundRefresh()
        Task { @MainActor in
            if appModel.isLoggedIn {
                ReencodeActivityCoordinator.shared.start(model: appModel)
            }
        }
        return true
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
    @State private var selection: RootTab
    /// The zoom namespace lives on a real View, not the App struct: `@Namespace`
    /// only participates in the view hierarchy when declared on a View, so an
    /// App-level one leaves the source/destination transitions inert.
    @Namespace private var zoomNamespace

    init() {
        // Home is the landing tab for everyone. Debug `RAWKOON_TAB` (a tab name or a
        // legacy index) still wins.
        var initial = RootTab.home
        #if DEBUG
            if let raw = ProcessInfo.processInfo.environment["RAWKOON_TAB"],
               let tab = RootTab.debugSelection(raw)
            {
                initial = tab
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

    @ViewBuilder
    private func tabRoot(_ tab: RootTab) -> some View {
        switch tab {
        case .home: NavigationStack { HomeView() }
        case .library: NavigationStack { LibraryView(forcedSection: .media) }
        case .books: NavigationStack { LibraryView(forcedSection: .books) }
        case .discover: NavigationStack { DiscoverView() }
        case .explore: NavigationStack { ExploreView(embedded: true) }
        case .notifications: NavigationStack { NotificationsListView() }
        case .settings: NavigationStack { SettingsView(scope: compact ? .all : .personal) }
        case .activity: NavigationStack { ActivityView() }
        case .requests: NavigationStack { RequestsView() }
        case .watchlist: NavigationStack { WatchlistView() }
        case .server: NavigationStack { SettingsView(scope: .server) }
        }
    }

    /// The sidebar floats the mini player over content, so each stack scrolls clear of it.
    private func sidebarRoot(_ tab: RootTab) -> some View {
        tabRoot(tab)
            .background(NavigationBottomInset(
                bottom: model.activeBook() == nil ? 0 : MiniPlayerInset.height,
                mountedTabs: 0
            ))
    }

    /// By device, not size class: an iPad window crossing compact width would
    /// otherwise swap containers and drop every tab's navigation state.
    private var compact: Bool {
        UIDevice.current.userInterfaceIdiom == .phone
    }

    private var mainTabs: some View {
        // Getter validates so a tab absent at this width can't stay selected
        // mid-render; setter stores the raw pick.
        let validSelection = Binding(
            get: { RootTab.validated(selection.rawValue, compact: compact, isAdmin: model.isAdmin) },
            set: { selection = $0 }
        )
        return Group {
            if compact {
                PhoneTabsView(selection: validSelection, onExpandPlayer: { showFullPlayer = true }) { tab in
                    tabRoot(tab)
                }
            } else {
                // The phone container insets its own navigation bars for the strip.
                sidebarTabs(validSelection)
                    .offlineStrip(isOffline: model.isOffline)
            }
        }
        .focusedSceneValue(\.rootTabSelection, validSelection)
        .focusedSceneValue(\.showPlayer) { showFullPlayer = true }
        .onOpenURL { url in
            guard url.scheme == "rawkoon" else { return }
            switch url.host {
            case "home": selection = .home
            case "discover": selection = .discover
            case "media":
                guard let link = MediaLink(url: url) else { return }
                selection = .home
                model.pendingMediaLink = link
            default: break
            }
        }
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
        .alert(
            model.pendingConfirm?.title ?? "",
            isPresented: Binding(
                get: { model.pendingConfirm != nil },
                set: {
                    if !$0 {
                        model.pendingConfirm = nil
                    }
                }
            ),
            presenting: model.pendingConfirm
        ) { request in
            Button(request.confirmTitle, role: request.isDestructive ? .destructive : nil) {
                request.action()
            }
            if let secondaryTitle = request.secondaryTitle {
                Button(secondaryTitle) { request.secondaryAction?() }
            }
            if let cancelTitle = request.cancelTitle {
                Button(cancelTitle, role: .cancel) {}
            } else {
                Button("Cancel", role: .cancel) {}
            }
        } message: { request in
            Text(request.message)
        }
        .sheet(isPresented: $showFullPlayer) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environment(model)
            }
        }
        .task {
            if model.needsLibraryRefresh {
                await model.loadLibrary()
            }
        }
    }

    private func sidebarTabs(_ selection: Binding<RootTab>) -> some View {
        TabView(selection: selection) {
            Tab("Home", systemImage: "house", value: RootTab.home) { sidebarRoot(.home) }
                .customizationID("tab.home")
            Tab("Notifications", systemImage: "bell", value: RootTab.notifications) { sidebarRoot(.notifications) }
                .badge(model.unreadNotificationCount)
                .customizationID("tab.notifications")
            TabSection("Library") {
                Tab("Movies & Shows", systemImage: "film.stack", value: RootTab.library) { sidebarRoot(.library) }
                    .customizationID("tab.library")
                Tab("Books", systemImage: "books.vertical", value: RootTab.books) { sidebarRoot(.books) }
                    .customizationID("tab.books")
                Tab("Watchlist", systemImage: "bookmark", value: RootTab.watchlist) { sidebarRoot(.watchlist) }
                    .customizationID("tab.watchlist")
            }
            TabSection("Discover") {
                Tab("Discover", systemImage: "sparkles.rectangle.stack", value: RootTab.discover) { sidebarRoot(.discover) }
                    .customizationID("tab.discover")
                Tab("Explore", systemImage: "square.grid.2x2", value: RootTab.explore) { sidebarRoot(.explore) }
                    .customizationID("tab.explore")
            }
            TabSection("Pipeline") {
                Tab("Activity", systemImage: "arrow.down.circle", value: RootTab.activity) { sidebarRoot(.activity) }
                    .customizationID("tab.activity")
                Tab("Requests", systemImage: "tray.and.arrow.down", value: RootTab.requests) { sidebarRoot(.requests) }
                    .customizationID("tab.requests")
            }
            TabSection("Settings") {
                Tab("Preferences", systemImage: "gearshape", value: RootTab.settings) { sidebarRoot(.settings) }
                    .customizationID("tab.settings")
                if model.isAdmin {
                    Tab("Server", systemImage: "server.rack", value: RootTab.server) { sidebarRoot(.server) }
                        .customizationID("tab.server")
                }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        // Sidebar-only brand header (iPad/Mac).
        .tabViewSidebarHeader { RawkoonSidebarHeader() }
        .tint(Theme.apricot)
        .miniPlayerAccessory(model: model, onExpand: { showFullPlayer = true })
    }
}

/// Room the sidebar's floating mini player needs at the bottom of each stack.
enum MiniPlayerInset {
    static let height: CGFloat = 76
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
