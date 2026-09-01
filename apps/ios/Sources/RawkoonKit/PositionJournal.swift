import Foundation

public struct PositionEntry: Codable, Equatable, Sendable {
    public let editionId: Int
    public let positionSecs: Double
    public let atMillis: Int64

    public init(editionId: Int, positionSecs: Double, atMillis: Int64) {
        self.editionId = editionId
        self.positionSecs = positionSecs
        self.atMillis = atMillis
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

    public static func parse(_ text: String) -> [PositionEntry] {
        let decoder = JSONDecoder()
        return text.split(separator: "\n", omittingEmptySubsequences: true).compactMap { line in
            guard let data = line.data(using: .utf8) else { return nil }
            return try? decoder.decode(PositionEntry.self, from: data)
        }
    }

    public static func latest(in text: String, editionId: Int) -> PositionEntry? {
        parse(text).reduce(nil) { latest, entry in
            guard entry.editionId == editionId else { return latest }
            guard let latest else { return entry }
            return latest.atMillis <= entry.atMillis ? entry : latest
        }
    }
}
