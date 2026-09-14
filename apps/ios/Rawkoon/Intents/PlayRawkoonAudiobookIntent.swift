import AppIntents

/// "Play <audiobook> in Rawkoon" from Shortcuts and Siri. A thin shell over
/// AudiobookPlaybackAction; opening the app is required because playback runs
/// in the app's audio session, not the intent process.
struct PlayRawkoonAudiobookIntent: AppIntent {
    static let title: LocalizedStringResource = "Play Audiobook"
    static let description = IntentDescription("Play an audiobook from your Rawkoon library.")
    static let openAppWhenRun = true

    @Parameter(title: "Audiobook")
    var audiobook: RawkoonAudiobookEntity

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let action = AudiobookPlaybackAction(adapter: AppModelPlaybackAdapter(model: .shared))
        switch await action.run(editionId: audiobook.id) {
        case .played:
            return .result(dialog: "Playing \(audiobook.title).")
        case .loggedOut:
            return .result(dialog: "Sign in to Rawkoon to play audiobooks.")
        case .notFound:
            return .result(dialog: "That audiobook isn't available.")
        case let .playbackFailed(message):
            return .result(dialog: "\(message ?? String(localized: "Couldn't play that audiobook."))")
        }
    }
}
