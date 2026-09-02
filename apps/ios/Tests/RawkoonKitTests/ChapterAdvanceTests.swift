@testable import RawkoonKit
import XCTest

final class ChapterAdvanceTests: XCTestCase {
    /// The production change that would make these fail: auto-advance skipping
    /// an unplayable chapter and landing later in the book (the chapter-17-to-
    /// last-chapter bug).
    private func chapter(_ index: Int, title: String = "") -> ManifestChapter {
        let start = Double(index) * 10
        return ManifestChapter(
            index: index,
            title: title.isEmpty ? "Chapter \(index + 1)" : title,
            startSecs: start,
            endSecs: start + 10,
            fileId: 100 + index,
            sizeBytes: 1000,
            sha256: nil,
            url: "u\(index)"
        )
    }

    func testEndingTheLastChapterFinishesTheBook() {
        let chapters = [chapter(0), chapter(1), chapter(2)]
        XCTAssertEqual(
            chapterAdvanceDecision(endedIndex: 2, chapters: chapters, nextIsPlayable: true),
            .finishedBook
        )
    }

    func testEndingAChapterPlaysTheImmediateNextWhenItIsPlayable() {
        let chapters = [chapter(0), chapter(1), chapter(2)]
        XCTAssertEqual(
            chapterAdvanceDecision(endedIndex: 0, chapters: chapters, nextIsPlayable: true),
            .playNext(index: 1)
        )
    }

    /// The reported bug: chapter 17 ended, 18 was unplayable, the queue walked
    /// to the last chapter. The only legal answer is stop, naming chapter 18.
    func testUnplayableNextChapterStopsAndDoesNotSkipAhead() {
        let chapters = (0 ..< 20).map { chapter($0) }
        let decision = chapterAdvanceDecision(
            endedIndex: 16,
            chapters: chapters,
            nextIsPlayable: false
        )
        XCTAssertEqual(
            decision,
            .stopWithError(index: 17, title: "Chapter 18")
        )
    }

    func testUnplayableNextUsesDomainIndicesWhenTheyHaveGaps() {
        let chapters = [chapter(5, title: "Five"), chapter(7, title: "Seven")]
        XCTAssertEqual(
            chapterAdvanceDecision(endedIndex: 5, chapters: chapters, nextIsPlayable: false),
            .stopWithError(index: 7, title: "Seven")
        )
    }

    func testUnknownEndedChapterDoesNotPretendTheBookFinished() {
        let chapters = [chapter(0), chapter(1)]
        XCTAssertEqual(
            chapterAdvanceDecision(endedIndex: 99, chapters: chapters, nextIsPlayable: true),
            .stopWithError(index: 99, title: "")
        )
    }

    func testQueueDrainingOnTheLastChapterIsANormalFinish() {
        XCTAssertEqual(
            queueDrainedDecision(endedIndex: 4, lastIndex: 4),
            .treatAsFinished
        )
    }

    /// currentItem == nil while we were still in the middle of the book is the
    /// skip-to-end lie: the player used to set chapter = last and position =
    /// duration.
    func testQueueDrainingMidBookIsAnErrorNotTheLastChapter() {
        XCTAssertEqual(
            queueDrainedDecision(endedIndex: 16, lastIndex: 60),
            .stopWithError
        )
        XCTAssertEqual(
            queueDrainedDecision(endedIndex: nil, lastIndex: 60),
            .stopWithError
        )
    }

    func testUnplayableMessageNamesTheChapter() {
        XCTAssertEqual(
            unplayableChapterMessage(title: "Chapter 18"),
            "\"Chapter 18\" couldn't be played. Playback stopped."
        )
        XCTAssertEqual(
            unplayableChapterMessage(title: ""),
            "The next chapter couldn't be played. Playback stopped."
        )
    }
}
