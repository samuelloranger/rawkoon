import AppIntents
import RawkoonKit

/// "Resume my audiobook in Rawkoon" — no argument. Plays the loaded book if the
/// player has one, otherwise the most recently in-progress audiobook.
struct ResumeRawkoonAudiobookIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Resume Audiobook"
    static let description = IntentDescription("Resume your most recent Rawkoon audiobook.")
    /// Audio playback intents may start the app's audio session in the
    /// background, so Siri in the car does not ask to unlock the phone.
    static let openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let model = AppModel.shared
        guard model.isLoggedIn else {
            return .result(dialog: "Sign in to Rawkoon to play audiobooks.")
        }
        // A cold launch has no library yet, so nothing would look in progress.
        await model.ensureLibraryLoaded()
        let entries = await model.carPlayAudiobooks()
        guard let editionId = AudiobookResume.editionId(
            activeEditionId: model.activeEditionId,
            entries: entries
        ) else {
            return .result(dialog: "You don't have an audiobook in progress.")
        }
        let action = AudiobookPlaybackAction(adapter: AppModelPlaybackAdapter(model: model))
        switch await action.run(editionId: editionId) {
        case .played:
            return .result(dialog: "Resuming your audiobook.")
        case .loggedOut:
            return .result(dialog: "Sign in to Rawkoon to play audiobooks.")
        case .notFound:
            return .result(dialog: "That audiobook isn't available.")
        case let .playbackFailed(message):
            return .result(dialog: "\(message ?? String(localized: "Couldn't play that audiobook."))")
        }
    }
}
