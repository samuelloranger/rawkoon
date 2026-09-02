import Foundation
import Security

enum Keychain {
    private static let service = "cloud.samlo.rawkoon"

    /// Persists `value` under `key`. Returns whether the write actually landed.
    ///
    /// A `false` result means nothing was stored — most commonly
    /// `errSecMissingEntitlement` (-34018) on a `CODE_SIGNING_ALLOWED=NO`
    /// simulator build, whose entitlements dict is empty. A caller persisting a
    /// credential must not report a durable success on `false`, or the next
    /// launch silently starts logged out with no signal. `@discardableResult`
    /// so non-critical writes (device id) can stay one-liners.
    @discardableResult
    static func set(_ value: String, for key: String) -> Bool {
        let data = Data(value.utf8)
        var query = baseQuery(for: key)
        let attributes = [kSecValueData as String: data]

        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(query as CFDictionary, nil)
        }

        guard status == errSecSuccess else {
            Log.auth.error(
                "Keychain write failed: key=\(key, privacy: .public) status=\(status, privacy: .public)"
            )
            return false
        }
        return true
    }

    static func get(_ key: String) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        SecItemDelete(baseQuery(for: key) as CFDictionary)
    }

    private static func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
