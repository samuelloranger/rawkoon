import Foundation
import RawkoonKit

/// Keeps positions and downloads of one server from being read as another's after a
/// sign-out and a sign-in elsewhere (edition ids are per-server). Nothing is deleted:
/// other servers' entries are hidden until their own sign-in.
extension AppModel {
    static let serverScopeKey = "server_scope_key"

    /// The key saved at the last identity change; nil on a session that predates this. Entries a
    /// background download wrote while the key was unreadable belong to this session, so they are stamped now.
    func restoreServerScope() {
        guard isLoggedIn else { return }
        let key = Keychain.get(Self.serverScopeKey)
        ActiveServerKey.shared.value = key
        if let key { adoptLegacyEntries(serverKey: key) }
    }

    /// Runs once the signed-in user's id is known. The first key after an update adopts every
    /// unstamped (legacy) journal line and download record, so nothing already downloaded is lost.
    func updateServerScope(userId: String) {
        let key = ServerScope.key(userId: userId)
        guard ActiveServerKey.shared.value != key else { return }
        ActiveServerKey.shared.value = key
        Keychain.set(key, for: Self.serverScopeKey)
        adoptLegacyEntries(serverKey: key)
        refreshDownloadedBookIds()
        restoreDownloadedAudiobooks()
    }

    private func adoptLegacyEntries(serverKey key: String) {
        DownloadedStore.adoptLegacy(serverKey: key)
        let journal = readJournal()
        let adopted = PositionJournal.adopting(journal, serverKey: key)
        if adopted != journal {
            try? adopted.write(to: journalURL, atomically: true, encoding: .utf8)
        }
    }

    func clearServerScope() {
        ActiveServerKey.shared.value = nil
        Keychain.delete(Self.serverScopeKey)
        refreshDownloadedBookIds()
    }
}
