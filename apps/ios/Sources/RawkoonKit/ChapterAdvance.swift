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

public func queueDrainedDecision(endedIndex: Int?, lastIndex: Int?) -> QueueDrainedDecision {
    guard let endedIndex, let lastIndex, endedIndex == lastIndex else {
        return .stopWithError
    }
    return .treatAsFinished
}

public func unplayableChapterMessage(title: String) -> String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return "The next chapter couldn't be played. Playback stopped."
    }
    return "\"\(trimmed)\" couldn't be played. Playback stopped."
}
