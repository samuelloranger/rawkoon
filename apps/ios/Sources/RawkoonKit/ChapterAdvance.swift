import Foundation

/// What to do when the current chapter's file has ended.
///
/// The playlist must never skip an unplayable chapter and keep walking. That
/// is how a listener on chapter 17 landed on the last chapter of the book.
public enum ChapterAdvanceDecision: Equatable, Sendable {
    case finishedBook
    case playNext(index: Int)
    case stopWithError(index: Int, title: String)
}

/// An empty AVQueuePlayer is only "the book is over" when the chapter that
/// just ended was actually the last one. Any other drain used to snap the UI
/// to the last chapter and persist position = duration.
public enum QueueDrainedDecision: Equatable, Sendable {
    case treatAsFinished
    case stopWithError
}

/// Decides the single legal next step after a chapter file ends.
///
/// `nextIsPlayable` refers to the immediate next chapter only. If that one
/// cannot play, the answer is stop — never chapter N+2, never the last chapter.
public func chapterAdvanceDecision(
    endedIndex: Int,
    chapters: [ManifestChapter],
    nextIsPlayable: Bool
) -> ChapterAdvanceDecision {
    let ordered = chapters.sorted { $0.index < $1.index }
    guard let endedPos = ordered.firstIndex(where: { $0.index == endedIndex }) else {
        return .stopWithError(index: endedIndex, title: "")
    }
    let nextPos = ordered.index(after: endedPos)
    guard nextPos < ordered.endIndex else {
        return .finishedBook
    }
    let next = ordered[nextPos]
    if nextIsPlayable {
        return .playNext(index: next.index)
    }
    return .stopWithError(index: next.index, title: next.title)
}

/// How close to the end a drained queue has to be to count as a finished book.
let finishedBookToleranceSecs = 5.0

/// A queue that empties in the last chapter but short of its end lost an item
/// to a failure, so it is an error rather than a finished book.
public func queueDrainedDecision(
    endedIndex: Int?,
    lastIndex: Int?,
    positionSecs: Double,
    durationSecs: Double
) -> QueueDrainedDecision {
    guard let endedIndex, let lastIndex, endedIndex == lastIndex,
          positionSecs >= durationSecs - finishedBookToleranceSecs
    else {
        return .stopWithError
    }
    return .treatAsFinished
}

/// Where play() rebuilds from when no item is loaded: the current position,
/// or the start only for a book that is at its end (a replay).
public func playStartPosition(positionSecs: Double, durationSecs: Double) -> Double {
    positionSecs >= durationSecs - finishedBookToleranceSecs ? 0 : max(positionSecs, 0)
}

public func unplayableChapterMessage(title: String) -> String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return "The next chapter couldn't be played. Playback stopped."
    }
    return "\"\(trimmed)\" couldn't be played. Playback stopped."
}
