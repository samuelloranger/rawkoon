import Foundation

/// Pure pieces of the audiobook <-> ebook "same sentence" handoff: wire
/// bodies, response parsing, the stored reading position and error mapping.
public enum BookHandoff {
    // MARK: Requests

    public struct ToEbookBody: Encodable, Equatable, Sendable {
        public let positionSecs: Double

        public init(positionSecs: Double) {
            self.positionSecs = positionSecs
        }

        enum CodingKeys: String, CodingKey { case positionSecs = "position_secs" }
    }

    public struct ToAudiobookBody: Encodable, Equatable, Sendable {
        public let spinePath: String
        public let progression: Double

        public init(spinePath: String, progression: Double) {
            self.spinePath = spinePath
            // The server rejects anything outside 0...1.
            self.progression = min(max(progression, 0), 1)
        }

        enum CodingKeys: String, CodingKey {
            case spinePath = "spine_path"
            case progression
        }
    }

    // MARK: Responses

    /// Where the audiobook's sentence sits in the ebook.
    public struct EbookSpot: Equatable, Sendable {
        public let spineIndex: Int
        public let spinePath: String
        public let progression: Double
        /// The Readium Locator, re-serialised as JSON text so this package
        /// never imports Readium.
        public let locatorJSON: String?
    }

    /// Decoded by hand: the locator is nested, free-form JSON that must
    /// survive as a string, which Codable would not preserve.
    public static func parseEbookSpot(_ data: Data) -> EbookSpot? {
        guard
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let spineIndex = (root["spine_index"] as? NSNumber)?.intValue,
            let spinePath = root["spine_path"] as? String, !spinePath.isEmpty
        else { return nil }
        let progression = (root["progression"] as? NSNumber)?.doubleValue ?? 0
        var locatorJSON: String?
        if let locator = root["locator"] as? [String: Any],
           let encoded = try? JSONSerialization.data(withJSONObject: locator, options: [.sortedKeys])
        {
            locatorJSON = String(data: encoded, encoding: .utf8)
        }
        return EbookSpot(
            spineIndex: spineIndex,
            spinePath: spinePath,
            progression: progression,
            locatorJSON: locatorJSON
        )
    }

    /// The audiobook position from the to-audiobook response.
    public static func parseAudiobookPosition(_ data: Data) -> Double? {
        guard
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let secs = (root["position_secs"] as? NSNumber)?.doubleValue,
            secs.isFinite, secs >= 0
        else { return nil }
        return secs
    }

    // MARK: Reading position

    /// A position to save for the ebook edition. `knownSpineCount` is the
    /// stored one when there is one; otherwise the count only needs to be
    /// valid (server: `spine_index < spine_count`), and the reader overwrites
    /// it with the real count on its first location change.
    public static func readingPosition(
        from spot: EbookSpot,
        editionId: Int,
        fileId: Int?,
        knownSpineCount: Int?,
        nowMillis: Int64
    ) -> ReadingPosition {
        let spineIndex = max(spot.spineIndex, 0)
        return ReadingPosition(
            editionId: editionId,
            fileId: fileId,
            spineIndex: spineIndex,
            spinePath: spot.spinePath,
            spineCount: max(knownSpineCount ?? 0, spineIndex + 1),
            scrollFraction: spot.progression,
            finished: false,
            updatedAtMillis: nowMillis,
            locator: spot.locatorJSON
        )
    }

    // MARK: Href matching

    /// The server reports OPF-relative hrefs (`ch1.xhtml`) while Readium's reading
    /// order is container-root-relative (`OEBPS/ch1.xhtml`). Returns the reading-order
    /// entry for `href`: exact first, else the one entry that is a path-suffix of it or
    /// that it is a suffix of. Fragments and percent-encoding are ignored; nil when
    /// nothing matches or the match is ambiguous.
    public static func matchReadingOrderHref(_ href: String, in hrefs: [String]) -> String? {
        let target = normalizedHref(href)
        guard !target.isEmpty else { return nil }
        if let exact = hrefs.first(where: { normalizedHref($0) == target }) {
            return exact
        }
        let suffixed = hrefs.filter {
            let candidate = normalizedHref($0)
            return !candidate.isEmpty && (candidate.hasSuffix("/" + target) || target.hasSuffix("/" + candidate))
        }
        return suffixed.count == 1 ? suffixed[0] : nil
    }

    private static func normalizedHref(_ href: String) -> String {
        var text = href
        if let hash = text.firstIndex(of: "#") {
            text = String(text[..<hash])
        }
        text = text.removingPercentEncoding ?? text
        while text.hasPrefix("./") || text.hasPrefix("/") {
            text = String(text.drop(while: { $0 == "." || $0 == "/" }))
        }
        return text
    }

    /// The locator JSON with its `href` replaced, everything else kept.
    public static func locatorJSON(_ json: String, withHref href: String) -> String? {
        guard
            let data = json.data(using: .utf8),
            var root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        root["href"] = href
        guard let encoded = try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys]) else {
            return nil
        }
        return String(data: encoded, encoding: .utf8)
    }

    /// The locator's own `href`, when the JSON has one.
    public static func locatorHref(_ json: String) -> String? {
        guard
            let data = json.data(using: .utf8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        return root["href"] as? String
    }

    // MARK: Errors

    public enum Failure: Equatable, Sendable {
        /// 409: AI provider or the feature switch is off, or the budget is spent.
        case syncOff
        /// 422: no matching text at that spot.
        case spotNotFound
        /// 502, timeout or no connection.
        case unreachable
        /// 404: the book lacks an edition or its file.
        case needsBothEditions
        /// 409 `budget_exceeded`: the daily AI budget is spent.
        case budgetSpent
        /// 429: too many requests.
        case rateLimited
        case other
    }

    /// `code` is the server's `{error}` string when the body carried one.
    public static func classify(status: Int?, code: String? = nil) -> Failure {
        switch status {
        case 404: .needsBothEditions
        case 409: code == "budget_exceeded" ? .budgetSpent : .syncOff
        case 429: .rateLimited
        case 422: .spotNotFound
        case 502, 503, 504: .unreachable
        default: .other
        }
    }
}
