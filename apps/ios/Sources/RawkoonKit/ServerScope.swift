import Foundation

/// Which server account a journal line or downloaded-index entry belongs to.
///
/// Edition ids are per-server, so sign-out keeps on-device data but a different
/// server's edition 12 must never read another server's edition 12. Entries
/// written before this existed carry no key (`nil`): they are "legacy" and are
/// stamped once with the first key that becomes active, so nothing downloaded is lost.
public enum ServerScope {
    /// Stable across launches. The user id alone: ids are random per server, so servers differ,
    /// while the same account reached by a LAN address, a public name or another scheme or port
    /// keeps one key (a URL in the key would make its own downloads look foreign).
    public static func key(userId: String) -> String {
        "k" + ResponseCache.stem(userId)
    }

    /// Unstamped legacy entries stay visible until adoption stamps them, and an unknown
    /// active key (no identity yet, or a failed Keychain write) hides nothing.
    public static func isVisible(entryKey: String?, activeKey: String?) -> Bool {
        activeKey == nil || entryKey == nil || entryKey == activeKey
    }

    /// Stamped for a server other than the active one.
    public static func isForeign(entryKey: String?, activeKey: String?) -> Bool {
        !isVisible(entryKey: entryKey, activeKey: activeKey)
    }
}

/// The key of the signed-in session, readable from any thread (download callbacks
/// run off the main actor). Nil until the user's identity is known.
public final class ActiveServerKey: @unchecked Sendable {
    public static let shared = ActiveServerKey()
    private let lock = NSLock()
    private var current: String?

    public var value: String? {
        get { lock.withLock { current } }
        set { lock.withLock { current = newValue } }
    }
}
