import Foundation

/// Outcome of an audiobook playback request from an App Intent. A typed result
/// rather than a bare success/throw so Siri and Shortcuts can report a clear
/// reason instead of silently claiming success.
enum AudiobookPlaybackResult: Equatable {
    case played
    case loggedOut
    case notFound
    case playbackFailed(String?)
}

/// The slice of `AppModel` playback that an intent needs, injected so the action
/// is testable without a live model. `openPlayer` reports failure by leaving the
/// requested edition unloaded (it swallows errors into the model rather than
/// throwing), so the action checks the loaded edition before it plays.
@MainActor
protocol AudiobookPlaybackAdapting {
    var isLoggedIn: Bool { get }
    var loadedEditionId: Int? { get }
    var lastError: String? { get }
    func openPlayer(editionId: Int) async
    func play()
}

/// Authenticated "play this audiobook" action shared by every audiobook intent.
struct AudiobookPlaybackAction {
    let adapter: any AudiobookPlaybackAdapting

    @MainActor
    func run(editionId: Int) async -> AudiobookPlaybackResult {
        guard adapter.isLoggedIn else { return .loggedOut }
        await adapter.openPlayer(editionId: editionId)
        // The edition only becomes the loaded one when its manifest resolved;
        // an unknown edition or a load failure leaves it unset.
        guard adapter.loadedEditionId == editionId else { return .notFound }
        adapter.play()
        if let error = adapter.lastError {
            return .playbackFailed(error)
        }
        return .played
    }
}

/// Production adapter over the live `AppModel`.
@MainActor
struct AppModelPlaybackAdapter: AudiobookPlaybackAdapting {
    let model: AppModel

    var isLoggedIn: Bool {
        model.isLoggedIn
    }

    var loadedEditionId: Int? {
        model.activeEditionId
    }

    /// A play failure surfaces on the player; a load failure on the model.
    var lastError: String? {
        model.player.playbackError ?? model.errorMessage
    }

    func openPlayer(editionId: Int) async {
        await model.openPlayer(editionId: editionId)
    }

    func play() {
        model.player.play()
    }
}
