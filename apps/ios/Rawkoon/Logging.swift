import os

/// The app's single logging surface: one `Logger` per domain, all sharing one
/// subsystem string.
///
/// `cloud.samlo.rawkoon` is not an implementation detail — it is the predicate
/// every `log stream` command, saved Console filter, and collected sysdiagnose
/// archive is keyed on. Changing it later invalidates every filter a developer
/// has already saved, so treat it as a published name.
///
/// Category boundaries follow the domain that owns the failure, not the file
/// that happens to log it:
/// - `playback`: the audio session and Now Playing / interruption state machine
/// - `download`: the chapter download queue and its background URLSession
/// - `network`: API requests and responses
/// - `auth`: sign-in, token/grant refresh, and Keychain access
/// - `sync`: library and manifest refresh
// Not MainActor: os.Logger is Sendable and this namespace is called from
// every isolation domain in the app (background download delegate queues
// included), so it must stay isolation-free.
nonisolated enum Log {
    private static let subsystem = "cloud.samlo.rawkoon"

    static let playback = Logger(subsystem: subsystem, category: "playback")
    static let download = Logger(subsystem: subsystem, category: "download")
    static let network = Logger(subsystem: subsystem, category: "network")
    static let auth = Logger(subsystem: subsystem, category: "auth")
    static let sync = Logger(subsystem: subsystem, category: "sync")
}
