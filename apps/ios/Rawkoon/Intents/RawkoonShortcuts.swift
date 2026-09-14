import AppIntents

/// Surfaces Rawkoon's audiobook actions to Siri and Spotlight with spoken
/// phrases, so a listener can play or resume without opening the app first.
struct RawkoonShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ResumeRawkoonAudiobookIntent(),
            phrases: [
                "Resume my audiobook in \(.applicationName)",
                "Continue my audiobook in \(.applicationName)",
            ],
            shortTitle: "Resume Audiobook",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: PlayRawkoonAudiobookIntent(),
            phrases: [
                "Play \(\.$audiobook) in \(.applicationName)",
            ],
            shortTitle: "Play Audiobook",
            systemImageName: "book.fill"
        )
    }
}
