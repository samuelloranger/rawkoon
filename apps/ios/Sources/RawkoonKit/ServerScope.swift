import Foundation

/// Which server (and user) a journal line or downloaded-index entry belongs to.
///
/// Edition ids are per-server, so sign-out keeps on-device data but a different
/// server's edition 12 must never read another server's edition 12. Entries
/// written before this existed carry no key (`nil`): they are "legacy" and are
/// stamped once with the first key that becomes active, so nothing downloaded is lost.
public enum ServerScope {
    /// Stable across launches; the user id keeps two accounts on one server apart.
    public static func key(serverURL: String, userId: String) -> String {
        var url = serverURL.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        while url.hasSuffix("/") {
            url.removeLast()
        }
        return "k" + ResponseCache.stem(url + "|" + userId)
    }

    /// Legacy (unstamped) entries stay visible until adoption stamps them.
    public static func isVisible(entryKey: String?, activeKey: String?) -> Bool {
        entryKey == nil || entryKey == activeKey
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
