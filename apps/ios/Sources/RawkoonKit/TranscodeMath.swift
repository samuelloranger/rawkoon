import Foundation

public enum TranscodeMovePlacement: Equatable, Sendable {
    case before(Int)
    case after(Int)
}

public struct TranscodeMove: Equatable, Sendable {
    public let id: Int
    public let placement: TranscodeMovePlacement
}

/// Pure helpers for the re-encode screens (mirrors the web client's math).
public enum TranscodeMath {
    /// Video bitrate that makes a batch average `gbPerFile` once audio is counted.
    public static func targetKbps(gbPerFile: Double, fileCount: Int, totalAudioBytes: Double, totalDurationSecs: Double) -> Int {
        guard totalDurationSecs > 0 else { return 100 }
        let videoBits = (gbPerFile * 1e9 * Double(fileCount) - totalAudioBytes) * 8
        return max(100, Int((videoBits / totalDurationSecs / 1000).rounded()))
    }

    /// True when the source already fits the box, so downscaling to it would do nothing.
    public static func fitsBox(sourceWidth: Int?, sourceHeight: Int?, boxWidth: Int, boxHeight: Int) -> Bool {
        guard let sourceHeight else { return false }
        return sourceHeight <= boxHeight && (sourceWidth ?? 0) <= boxWidth
    }

    public static func minutes(fromHHMM text: String) -> Int? {
        let parts = text.split(separator: ":")
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]), (0 ..< 24).contains(h), (0 ..< 60).contains(m)
        else { return nil }
        return h * 60 + m
    }

    public static func hhmm(fromMinutes minutes: Int) -> String {
        let wrapped = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", wrapped / 60, wrapped % 60)
    }

    public static func stepIndex(_ step: String?) -> Int? {
        switch step {
        case "encode": 0
        case "validate": 1
        case "replace": 2
        case "rescan": 3
        default: nil
        }
    }

    /// Turns one SwiftUI `.onMove` into a single API move relative to the new neighbour.
    public static func movePlacement(ids: [Int], from source: IndexSet, to destination: Int) -> TranscodeMove? {
        guard ids.count > 1, source.count == 1, let from = source.first, ids.indices.contains(from) else { return nil }
        var order = ids
        let moved = order.remove(at: from)
        let insertAt = destination > from ? destination - 1 : destination
        guard insertAt != from else { return nil }
        order.insert(moved, at: min(max(insertAt, 0), order.count))
        guard let newIndex = order.firstIndex(of: moved) else { return nil }
        return newIndex == 0
            ? TranscodeMove(id: moved, placement: .before(order[1]))
            : TranscodeMove(id: moved, placement: .after(order[newIndex - 1]))
    }
}
