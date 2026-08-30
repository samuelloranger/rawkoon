import Foundation

/// Whole-book position arithmetic, and the only place it is allowed to live.
///
/// Every position in this client is a whole-book offset in seconds. The removed
/// web player stored a file index plus an in-file offset, and its own comment
/// records the result: a resume could resolve to an index that did not exist,
/// so it "only ever worked from position 0". One number cannot desynchronise
/// from a file list.
public struct BookTimeline: Sendable {
    public let chapters: [ManifestChapter]

    public init(chapters: [ManifestChapter]) {
        self.chapters = chapters.sorted { $0.index < $1.index }
    }

    public var totalDurationSecs: Double { chapters.last?.endSecs ?? 0 }

    /// The chapter containing `positionSecs`, or nil when outside the book.
    ///
    /// A position exactly on a boundary belongs to the chapter it STARTS. The
    /// half-open interval is what makes "skip to next chapter" land in the next
    /// chapter rather than at the last instant of the current one.
    public func chapterIndex(at positionSecs: Double) -> Int? {
        guard positionSecs >= 0, positionSecs < totalDurationSecs else { return nil }
        return chapters.firstIndex { positionSecs >= $0.startSecs && positionSecs < $0.endSecs }
    }

    public func offsetWithinChapter(at positionSecs: Double) -> (index: Int, offsetSecs: Double)? {
        guard let i = chapterIndex(at: positionSecs) else { return nil }
        return (i, positionSecs - chapters[i].startSecs)
    }

    public func position(chapterIndex index: Int, offsetSecs: Double) -> Double? {
        guard chapters.indices.contains(index) else { return nil }
        return chapters[index].startSecs + offsetSecs
    }

    public func clamp(_ positionSecs: Double) -> Double {
        min(max(positionSecs, 0), totalDurationSecs)
    }

    public func boundary(after positionSecs: Double) -> Double? {
        chapters.first { $0.startSecs > positionSecs }?.startSecs
    }

    public func boundary(before positionSecs: Double) -> Double? {
        chapters.last { $0.startSecs < positionSecs }?.startSecs
    }
}
