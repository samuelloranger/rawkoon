import Foundation

public struct PositionEntry: Codable, Equatable, Sendable {
    public let editionId: Int
    public let positionSecs: Double
    public let atMillis: Int64
    /// The server it was recorded against; nil on lines written before servers were told apart.
    public let serverKey: String?

    public init(editionId: Int, positionSecs: Double, atMillis: Int64, serverKey: String? = nil) {
        self.editionId = editionId
        self.positionSecs = positionSecs
        self.atMillis = atMillis
        self.serverKey = serverKey
    }

    public func with(serverKey: String?) -> PositionEntry {
        PositionEntry(editionId: editionId, positionSecs: positionSecs, atMillis: atMillis, serverKey: serverKey)
    }
}

/// An append-only log of listening positions, one JSON object per line.
///
/// iOS termination hooks are not reliable, so nothing is saved on quit:
/// positions are appended as they happen and the newest survivor wins. Parsing
/// therefore has to tolerate a truncated final line, because the process can be
/// killed mid-append - that case is the reason this is a log at all.
public enum PositionJournal {
    public static func encode(_ entry: PositionEntry) -> String {
        guard let data = try? JSONEncoder().encode(entry),
              let line = String(data: data, encoding: .utf8)
        else {
            return ""
        }
        return line + "\n"
    }

    /// The text to append. A journal killed mid-append ends without a newline;
    /// a leading one keeps the next entry from joining onto that partial line.
    public static func appendText(for entry: PositionEntry, afterPartialLine: Bool) -> String {
        let line = encode(entry)
        return line.isEmpty || !afterPartialLine ? line : "\n" + line
    }

    public static func parse(_ text: String) -> [PositionEntry] {
        let decoder = JSONDecoder()
        return text.split(separator: "\n", omittingEmptySubsequences: true).compactMap { line in
            guard let data = line.data(using: .utf8) else { return nil }
            return try? decoder.decode(PositionEntry.self, from: data)
        }
    }

    /// Only entries the active server may see: its own, plus unstamped legacy ones.
    public static func latest(in text: String, editionId: Int, serverKey: String?) -> PositionEntry? {
        latestByEdition(text, serverKey: serverKey)[editionId]
    }

    /// The newest visible entry per edition, from one parse of the journal.
    public static func latestByEdition(_ text: String, serverKey: String?) -> [Int: PositionEntry] {
        var latest: [Int: PositionEntry] = [:]
        for entry in parse(text) where ServerScope.isVisible(entryKey: entry.serverKey, activeKey: serverKey) {
            if (latest[entry.editionId]?.atMillis ?? .min) <= entry.atMillis {
                latest[entry.editionId] = entry
            }
        }
        return latest
    }

    private struct Slot: Hashable {
        let serverKey: String?
        let editionId: Int
    }

    /// One line per server and edition, oldest first. The journal is append-only, so without
    /// this every five seconds of listening stays in it forever. Another server's lines are kept.
    public static func compacted(_ text: String) -> String {
        var latest: [Slot: PositionEntry] = [:]
        for entry in parse(text) {
            let slot = Slot(serverKey: entry.serverKey, editionId: entry.editionId)
            if (latest[slot]?.atMillis ?? .min) <= entry.atMillis {
                latest[slot] = entry
            }
        }
        return latest.values.sorted { $0.atMillis < $1.atMillis }.map { encode($0) }.joined()
    }

    /// Stamps every legacy line with `serverKey`, once, when the first identity becomes known.
    public static func adopting(_ text: String, serverKey: String) -> String {
        compacted(parse(text).map { encode($0.serverKey == nil ? $0.with(serverKey: serverKey) : $0) }.joined())
    }

    /// Drop the active server's lines for the given editions so a local resume cannot PUT a
    /// wiped server position back. Another server's lines stay.
    public static func excluding(_ text: String, editionIds: Set<Int>, serverKey: String?) -> String {
        parse(text)
            .filter {
                !(editionIds.contains($0.editionId) && ServerScope.isVisible(entryKey: $0.serverKey, activeKey: serverKey))
            }
            .map { encode($0) }
            .joined()
    }
}
