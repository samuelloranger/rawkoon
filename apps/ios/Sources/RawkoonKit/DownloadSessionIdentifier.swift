/// The background URLSession identifier of one edition's download. Its text must stay
/// stable: iOS hands it back after a relaunch, and it is the only way to find the edition.
public enum DownloadSessionIdentifier {
    private static let prefix = "cloud.samlo.rawkoon.dl."

    public static func make(editionId: Int) -> String {
        "\(prefix)\(editionId)"
    }

    /// Nil for any identifier that is not exactly the prefix plus a number.
    public static func editionId(from identifier: String) -> Int? {
        guard identifier.hasPrefix(prefix) else { return nil }
        return Int(identifier.dropFirst(prefix.count))
    }
}
