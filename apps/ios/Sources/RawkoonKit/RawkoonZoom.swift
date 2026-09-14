/// Stable, collision-free identity for zoom transitions across media types.
/// Kind-prefixed so a movie id and an audiobook edition id never clash when
/// they share the one app-level zoom namespace.
public enum RawkoonZoom {
    public typealias ID = String
    public static func media(tmdbId: Int, mediaType: String) -> ID {
        "\(mediaType):\(tmdbId)"
    }

    public static func book(_ bookId: Int) -> ID {
        "book:\(bookId)"
    }

    public static func audiobook(editionId: Int) -> ID {
        "audiobook:\(editionId)"
    }
}
