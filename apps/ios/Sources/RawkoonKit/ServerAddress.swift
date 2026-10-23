import Foundation

/// What a person types in the login server field, made into a base URL.
public enum ServerAddress {
    /// Trims, assumes https when no scheme was typed, and drops trailing slashes.
    /// Nil when the text can't be an http(s) server address.
    public static func normalize(_ raw: String) -> String? {
        var address = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty else { return nil }
        if !address.contains("://") {
            address = "https://" + address
        }
        while address.hasSuffix("/") {
            address.removeLast()
        }
        guard
            let url = URL(string: address),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            let host = url.host, !host.isEmpty
        else { return nil }
        return address
    }

    /// The host (and port, when one is set) to show as the server's name.
    public static func displayName(_ address: String) -> String {
        guard let url = URL(string: address), let host = url.host, !host.isEmpty else { return address }
        if let port = url.port {
            return "\(host):\(port)"
        }
        return host
    }
}
