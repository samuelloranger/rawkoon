import Foundation

/// Whole-book position arithmetic, and the only place it is allowed to live.
///
/// Every position in this client is a whole-book offset in seconds. The removed
/// web player stored a file index plus an in-file offset, and its own comment
/// records the result: a resume could resolve to an index that did not exist,
/// so it "only ever worked from position 0". One number cannot desynchronise
/// from a file list.
///
/// This API always speaks in DOMAIN chapter indices (`ManifestChapter.index`),
/// which are not assumed contiguous or 0-based.
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
        chapter(at: positionSecs)?.index
    }

    public func offsetWithinChapter(at positionSecs: Double) -> (index: Int, offsetSecs: Double)? {
        guard let chapter = chapter(at: positionSecs) else { return nil }
        return (chapter.index, positionSecs - chapter.startSecs)
    }

    public func position(chapterIndex index: Int, offsetSecs: Double) -> Double? {
        guard let chapter = chapters.first(where: { $0.index == index }) else { return nil }
        return chapter.startSecs + offsetSecs
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

    /// Offset inside the current chapter's file, if `positionSecs` still
    /// falls in that chapter. Nil means the seek crosses a chapter (or there
    /// is no current chapter) and the playback queue must be rebuilt.
    ///
    /// A position exactly on a chapter boundary belongs to the chapter it
    /// STARTS, matching `chapterIndex(at:)`. The last instant of the book is
    /// the exception: `chapterIndex` is nil there, but a scrub to the end
    /// of the last file is still in-place.
    public func inPlaceSeekOffset(fromChapterIndex current: Int?, to positionSecs: Double) -> Double? {
        guard let current else { return nil }
        let clamped = clamp(positionSecs)
        if let split = offsetWithinChapter(at: clamped) {
            guard split.index == current else { return nil }
            return split.offsetSecs
        }
        guard let last = chapters.last, last.index == current, clamped >= last.startSecs else {
            return nil
        }
        return last.durationSecs
    }

    private func chapter(at positionSecs: Double) -> ManifestChapter? {
        guard positionSecs >= 0, positionSecs < totalDurationSecs else { return nil }
        return chapters.first { positionSecs >= $0.startSecs && positionSecs < $0.endSecs }
    }
}
