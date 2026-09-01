@testable import RawkoonKit
import XCTest

final class DownloadPlanTests: XCTestCase {
    private func chapters(_ n: Int, size: Int = 1000) -> [ManifestChapter] {
        (0 ..< n).map { i in
            ManifestChapter(index: i, title: "C\(i)", startSecs: Double(i) * 10,
                            endSecs: Double(i + 1) * 10, fileId: 100 + i,
                            sizeBytes: size, sha256: nil, url: "u\(i)")
        }
    }

    func testStartsPendingAndOffersWorkUpToTheLimit() {
        let plan = DownloadPlan(chapters: chapters(5))
        XCTAssertEqual(plan.nextToStart(limit: 2), [100, 101])
        XCTAssertFalse(plan.isComplete)
    }

    func testASuccessfulCompletionVerifies() {
        var plan = DownloadPlan(chapters: chapters(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertTrue(plan.isComplete)
    }

    /// A background download task reports success for ANY response the server
    /// sent, including an error page. Status must be checked before the bytes
    /// are trusted, or a 401 body lands in the file as if it were audio.
    func testAnErrorStatusIsNotSuccess() {
        var plan = DownloadPlan(chapters: chapters(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 500, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
        XCTAssertFalse(plan.isComplete)
    }

    /// 401 is not a failure of the chapter, it is an expired grant. The chapter
    /// goes back to pending and the caller is told to refetch the manifest.
    func testExpiredGrantRequeuesWithoutConsumingAnAttempt() {
        var plan = DownloadPlan(chapters: chapters(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 401, bytes: 52, sha256: nil))
        XCTAssertEqual(plan.states[100], .pending)
        XCTAssertTrue(plan.needsFreshGrants)
        XCTAssertTrue(plan.nextToStart(limit: 5).contains(100))
    }

    func testWrongByteCountIsAFailure() {
        var plan = DownloadPlan(chapters: chapters(1, size: 1000))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 52, sha256: nil))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
    }

    func testMismatchedHashIsAFailure() {
        let c = [ManifestChapter(index: 0, title: "C0", startSecs: 0, endSecs: 10,
                                 fileId: 100, sizeBytes: 1000, sha256: "expected", url: "u")]
        var plan = DownloadPlan(chapters: c)
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: "different"))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
    }

    func testGivesUpAfterMaxAttempts() {
        var plan = DownloadPlan(chapters: chapters(1))
        for _ in 0 ..< DownloadPlan.maxAttempts {
            plan.apply(.started(fileId: 100))
            plan.apply(.transportFailed(fileId: 100))
        }
        XCTAssertEqual(plan.states[100], .failed(attempts: DownloadPlan.maxAttempts))
        XCTAssertTrue(plan.nextToStart(limit: 5).isEmpty)
    }

    func testInFlightChaptersAreNotOfferedAgain() {
        var plan = DownloadPlan(chapters: chapters(3))
        plan.apply(.started(fileId: 100))
        XCTAssertEqual(plan.nextToStart(limit: 3), [101, 102])
    }

    func testProgressFraction() {
        var plan = DownloadPlan(chapters: chapters(4))
        XCTAssertEqual(plan.progressFraction(), 0, accuracy: 1e-9)
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.progressFraction(), 0.25, accuracy: 1e-9)
    }

    func testEviction() {
        var plan = DownloadPlan(chapters: chapters(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        plan.apply(.evicted(fileId: 100))
        XCTAssertEqual(plan.states[100], .evicted)
        XCTAssertFalse(plan.isComplete)
    }

    func testRequestedResetsFailedChapterBackToPending() {
        var plan = DownloadPlan(chapters: chapters(1))
        for _ in 0 ..< DownloadPlan.maxAttempts {
            plan.apply(.started(fileId: 100))
            plan.apply(.transportFailed(fileId: 100))
        }

        XCTAssertEqual(plan.states[100], .failed(attempts: DownloadPlan.maxAttempts))
        XCTAssertTrue(plan.nextToStart(limit: 5).isEmpty)

        plan.apply(.requested(fileId: 100))
        XCTAssertEqual(plan.states[100], .pending)
        XCTAssertEqual(plan.nextToStart(limit: 5), [100])

        plan.apply(.started(fileId: 100))
        plan.apply(.transportFailed(fileId: 100))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
    }

    func testRequestedResetsEvictedChapterBackToPending() {
        var plan = DownloadPlan(chapters: chapters(1))
        plan.apply(.evicted(fileId: 100))
        XCTAssertEqual(plan.states[100], .evicted)

        plan.apply(.requested(fileId: 100))
        XCTAssertEqual(plan.states[100], .pending)
        XCTAssertEqual(plan.nextToStart(limit: 5), [100])
    }

    /// The flag has to clear, or every later emission re-triggers a refetch.
    func testAcknowledgingFreshGrantsClearsTheFlag() {
        var plan = DownloadPlan(chapters: chapters(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 401, bytes: 0, sha256: nil))
        XCTAssertTrue(plan.needsFreshGrants)

        plan.acknowledgeFreshGrants()

        XCTAssertFalse(plan.needsFreshGrants)
        // The chapter is still queued, not failed.
        XCTAssertEqual(plan.states[100], .pending)
    }
}
