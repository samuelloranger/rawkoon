/// Builds request bodies that OMIT a secret field when the user left it blank, so a
/// stored server-side secret is never wiped. A blank secret must never be sent as
/// null either — the server may read null as "clear it" (spec §4.4).
public enum SecretBody {
    public enum Value: Equatable, Sendable {
        case string(String)
        case bool(Bool)
        case int(Int)
        case double(Double)
    }

    /// Returns `base` unchanged when `value` is empty; otherwise adds `key` = `value`.
    public static func merge(base: [String: Value], secret key: String, value: String) -> [String: Value] {
        guard !value.isEmpty else { return base }
        var out = base
        out[key] = .string(value)
        return out
    }
}
