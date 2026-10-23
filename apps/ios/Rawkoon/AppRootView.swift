import RawkoonKit
import SwiftUI
import UIKit

/// The window's root. It lives in its own view, not in the `WindowGroup`
/// closure: SwiftUI can re-run that closure on its async render thread, where a
/// `@MainActor` closure that reads app state traps.
struct AppRootView: View {
    let model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    /// In-app UI-language override (see `AppLanguage`). Drives the environment
    /// locale for SwiftUI `Text`, and — via `APIClient` — the language the server
    /// localizes titles/metadata in.
    @AppStorage(AppLanguage.storageKey) private var appLanguage = AppLanguage.system.rawValue
    /// True means no Login hold is owed, so a signed-in launch never draws Login.
    @State private var loginExitFinished = true
    /// The pending Login hold, cancelled when the session changes again so a stale one can't end a newer hold.
    @State private var loginExitTask: Task<Void, Never>?

    var body: some View {
        Group {
            #if DEBUG
                if let screen = DebugScreen.requested, DebugScreen.isOffline(screen) {
                    DebugScreen.offlineView(for: screen)
                } else {
                    sessionRoot
                }
            #else
                sessionRoot
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
        .onAppear { Self.configureCatalystTitlebar() }
        // Server-localized content (titles, discovery) is language-tagged at
        // request time, so a language change must refetch the library to pull
        // titles in the new locale.
        .onChange(of: appLanguage) {
            guard model.isLoggedIn else { return }
            Task { await model.loadLibrary() }
        }
        // Login lingers over the new tabs for its success moment, then the root fades it away.
        // `initial` covers a root first rendered after the session already opened, which would strand Login.
        .onChange(of: model.isLoggedIn, initial: true) { _, isLoggedIn in
            loginExitTask?.cancel()
            guard isLoggedIn else {
                loginExitFinished = false
                return
            }
            loginExitTask = Task {
                try? await Task.sleep(for: LoginExit.linger)
                guard !Task.isCancelled, model.isLoggedIn else { return }
                loginExitFinished = true
            }
        }
        .onChange(of: model.isAdmin) { _, isAdmin in
            if isAdmin {
                ReencodeActivityCoordinator.shared.start(model: model)
            } else {
                ReencodeActivityCoordinator.shared.stop(model: model)
            }
        }
        // `.inactive` (a brief transitional state — Control Center, a system
        // alert) intentionally does nothing here; only a real background
        // transition tears the streams down.
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                Self.configureCatalystTitlebar()
                model.startLiveStreams()
                model.resyncDownloads()
                Task { await model.refreshUnreadNotificationCount() }
                Task { await model.refreshPendingRequestCount() }
                Task { await model.refreshBooksEnabled() }
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

    /// The tabs mount as soon as the session opens; Login stays on top until its exit finishes, then fades.
    private var sessionRoot: some View {
        let showsLogin = LoginExit.showsLogin(isLoggedIn: model.isLoggedIn, exitFinished: loginExitFinished)
        return ZStack {
            if model.isLoggedIn {
                RootTabsView()
                    .transition(.opacity)
            }
            if showsLogin {
                LoginView(hasSavedServer: !model.serverURL.isEmpty)
                    .transition(.opacity)
                    // Keeps the leaving Login above the tabs for its whole fade.
                    .zIndex(1)
                    // A lingering Login must not take taps or start a second sign-in.
                    .allowsHitTesting(!model.isLoggedIn)
                    .accessibilityHidden(model.isLoggedIn)
                    // Absorbs taps during the hold so they can't reach the tabs fading in underneath.
                    .overlay {
                        if model.isLoggedIn {
                            Color.clear.contentShape(Rectangle()).accessibilityHidden(true)
                        }
                    }
            }
        }
        .rawkoonMotion(RawkoonMotion.gentle, value: showsLogin)
        .rawkoonMotion(RawkoonMotion.gentle, value: model.isLoggedIn)
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
    private static func configureCatalystTitlebar() {
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
