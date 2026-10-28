import RawkoonKit
import SwiftUI

struct RootTabsView: View {
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
            case "releases": NavigationStack { ReleasesAdminView() }
            case "book": DebugFirstBook()
            case "playerReal": DebugRealPlayer()
            case "miniPlayer": DebugMiniPlayer { mainTabs }
            case "reader": DebugEbookReader()
            case "settings": NavigationStack { SettingsView() }
            case "users", "userDetail", "usersInvite", "usersImport", "invitations": DebugUsersScreen(screen: screen)
            case "requests": NavigationStack { RequestsView() }
            case "autoGrab": NavigationStack { AutoGrabSettingsView() }
            case "qualityProfileEditor": NavigationStack { DebugFirstQualityProfile() }
            case "notifications": NavigationStack { NotificationsSettingsView() }
            case "indexers": NavigationStack { IndexersSettingsView() }
            case "find", "explore": NavigationStack { FindView() }
            default: mainTabs
            }
        }
    #endif

    @ViewBuilder
    private func tabRoot(_ tab: RootTab) -> some View {
        switch tab {
        case .home: NavigationStack { HomeView().hiddenUntilSized() }
        case .library: NavigationStack { LibraryView(forcedSection: .media).hiddenUntilSized() }
        case .books: NavigationStack { LibraryView(forcedSection: .books).hiddenUntilSized() }
        case .find: NavigationStack { FindView().hiddenUntilSized() }
        case .settings: NavigationStack { SettingsView(scope: compact ? .all : .personal).hiddenUntilSized() }
        case .activity: NavigationStack { ActivityView().hiddenUntilSized() }
        case .server: NavigationStack { SettingsView(scope: .server).hiddenUntilSized() }
        }
    }

    /// The sidebar floats the mini player over content, so each stack scrolls clear of it.
    private func sidebarRoot(_ tab: RootTab) -> some View {
        tabRoot(tab)
            .background(NavigationBottomInset(
                bottom: model.activeBook() == nil ? 0 : MiniPlayerInset.height,
                stacks: 0
            ))
            // Kept-alive sidebar tabs share the zoom namespace; only the shown one registers plain ids.
            .environment(\.isActiveRootTab, tab == shownTab)
    }

    /// The selection as shown: a tab absent at this width or role falls back instead of staying selected.
    private var shownTab: RootTab {
        RootTab.validated(
            selection.rawValue, compact: compact, isAdmin: model.isAdmin, booksEnabled: model.booksEnabled
        )
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
            get: { shownTab },
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
        .onChange(of: model.requestedRootTab) { _, tab in
            guard let tab else { return }
            model.requestedRootTab = nil
            selection = tab
            // Find consumes the focus request on mount; drop it if nothing did.
            Task {
                try? await Task.sleep(for: .seconds(2))
                model.exploreSearchFocusRequest = false
            }
        }
        .task(id: [model.isAdmin ? 1 : 0, model.notificationChangeToken, model.reconnectToken]) {
            await model.refreshPendingRequestCount()
        }
        .focusedSceneValue(\.rootTabSelection, validSelection)
        .focusedSceneValue(\.showPlayer) { showFullPlayer = true }
        .onOpenURL { url in
            guard url.scheme == "rawkoon" else { return }
            switch url.host {
            case "home": selection = .home
            case "discover": selection = .find
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
        .onChange(of: model.playerPresentationRequest) { _, _ in
            if model.activeBook() != nil {
                showFullPlayer = true
            }
        }
        .task { await model.refreshBooksEnabled() }
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
            Tab("Find", systemImage: "magnifyingglass", value: RootTab.find) { sidebarRoot(.find) }
                .customizationID("tab.find")
            Tab("Activity", systemImage: "tray.full", value: RootTab.activity) { sidebarRoot(.activity) }
                .badge(model.activityBadgeCount)
                .customizationID("tab.activity")
            TabSection("Library") {
                Tab("Movies & Shows", systemImage: "film.stack", value: RootTab.library) { sidebarRoot(.library) }
                    .customizationID("tab.library")
                if model.booksEnabled {
                    Tab("Books", systemImage: "books.vertical", value: RootTab.books) { sidebarRoot(.books) }
                        .customizationID("tab.books")
                }
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
