import AppIntents

/// "Play <audiobook> in Rawkoon" from Shortcuts and Siri. A thin shell over
/// AudiobookPlaybackAction; it runs in the app process, whose audio session
/// plays the book.
struct PlayRawkoonAudiobookIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play Audiobook"
    static let description = IntentDescription("Play an audiobook from your Rawkoon library.")
    /// Audio playback intents may start the app's audio session in the
    /// background, so Siri in the car does not ask to unlock the phone.
    static let openAppWhenRun = false

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
