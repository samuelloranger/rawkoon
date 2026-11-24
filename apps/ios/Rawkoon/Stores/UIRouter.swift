import Foundation
import Observation
import RawkoonKit

/// Owns the toast banner and the "please open this" requests that screens, widgets
/// and notifications leave for the app root and tab views to consume.
@MainActor
@Observable
final class UIRouter {
    /// The add sheet currently waiting for an answer; presented by the app root.
    var addRequest: AddSheetRequest?
    /// Bumped to ask the root to show the full player (e.g. after "Listen from here" closes the reader).
    var playerPresentationRequest = 0
    /// A title a widget tap asked to open; Home pushes its detail and clears it.
    var pendingMediaLink: MediaLink?
    /// Shown by the app root: an alert attached to a screen pushed with the zoom
    /// transition stays hidden until the tab changes.
    var pendingConfirm: ConfirmRequest?
    /// Library id whose release sheet a toast action asked to open; the detail screen consumes it.
    var releaseSheetRequest: Int?
    /// A tab another screen asked to open (Home's search button, a calendar link); the root consumes it.
    var requestedRootTab: RootTab?
    /// Set when Explore should put its search field in focus; Explore clears it.
    var exploreSearchFocusRequest = false
    /// Browse or Swipe, kept for the session so a rebuilt Find tab reopens where it was.
    var findMode: FindMode = .browse
    /// A Find shelf a deep link asked to open; Find consumes it.
    var requestedFindShelf: FindShelf?
    /// An Activity lane a deep link or an inbox action asked to open; Activity consumes it.
    var requestedActivityLane: ActivityLane?

    /// Set from a banner tap or a notification-list row tap (via
    /// `navigate(toNotificationUrl:)`); `RawkoonApp` presents it as a sheet
    /// from the app root, so it works regardless of which tab is active.
    /// Bounded to the paths `NotificationDestination.resolve` understands —
    /// see spec T6.
    var deepLinkTarget: NotificationDestination?

    /// Current toast banner, rendered once at the app root by `ToastOverlay`.
    /// Any screen can call `toast(_:style:)` to surface a background action's
    /// result without owning any presentation state itself.
    var currentToast: Toast?
    private var toastDismissTask: Task<Void, Never>?

    /// Surfaces a brief banner at the app root and auto-dismisses it. This is
    /// the app-wide fix for actions that used to fail (or succeed) silently:
    /// call this from anywhere instead of stashing an error string a screen
    /// might not be showing.
    /// `duration` overrides the default lifetime (`.infinity` stays until replaced);
    /// `replacing` reuses a visible toast's identity so its content updates in place.
    @discardableResult
    func toast(
        _ message: String,
        style: Toast.Style = .info,
        action: ToastAction? = nil,
        duration: TimeInterval? = nil,
        showsProgress: Bool = false,
        replacing id: UUID? = nil
    ) -> UUID {
        var next = Toast(message: message, style: style, action: action, showsProgress: showsProgress)
        if let id, currentToast?.id == id {
            next.id = id
        }
        currentToast = next

        switch style {
        case .success: RawkoonHaptics.play(.success)
        case .error: RawkoonHaptics.play(.error)
        case .info: break
        }

        // An actionable toast (e.g. discover's "Undo") gets a longer window —
        // the user needs time to read it and decide, not just glance at it.
        let dismissDelay = duration ?? (action == nil ? 3 : 5)

        toastDismissTask?.cancel()
        toastDismissTask = nil
        if dismissDelay.isFinite {
            let shown = next.id
            toastDismissTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(dismissDelay))
                guard !Task.isCancelled, self?.currentToast?.id == shown else { return }
                self?.currentToast = nil
            }
        }
        return next.id
    }

    /// Asks the root to show the full player once whatever sheet is closing has gone.
    func presentPlayerAfterDismiss() {
        Task {
            try? await Task.sleep(for: .milliseconds(600))
            playerPresentationRequest += 1
        }
    }
}

/// A library title to open from outside the app, such as a widget tap.
struct MediaLink: Hashable {
    let libraryId: Int
    let tmdbId: Int
    let mediaType: String
    let title: String

    init?(url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value
        }
        guard url.host == "media",
              let library = value("library").flatMap(Int.init),
              let tmdb = value("tmdb").flatMap(Int.init),
              let type = value("type"), type == "movie" || type == "tv"
        else { return nil }
        libraryId = library
        tmdbId = tmdb
        mediaType = type
        title = value("title") ?? ""
    }
}

struct ConfirmRequest: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let confirmTitle: String
    var isDestructive = true
    let action: @MainActor () -> Void
    /// Optional middle choice (e.g. "Choose a release") between confirm and cancel.
    var secondaryTitle: String?
    var secondaryAction: (@MainActor () -> Void)?
    /// Overrides the default "Cancel" label.
    var cancelTitle: String?
}
