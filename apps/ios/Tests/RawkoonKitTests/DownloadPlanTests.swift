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

    // MARK: - Transient-failure stall + recovery (bug: 98% stuck forever)

    /// Reproduces the "stuck at 98%" report. A flaky network fails one chapter
    /// `maxAttempts` times while the rest verify. The plan then latches: the
    /// failed chapter is never offered again, so `isComplete` can never become
    /// true even though only transient network blips — not the chapter — were
    /// ever wrong. Nothing in a live session recovers it.
    func testOneTransientlyFailedChapterStallsTheWholeBookForever() {
        var plan = DownloadPlan(chapters: chapters(5))
        // Four chapters verify.
        for fileId in [100, 101, 102, 103] {
            plan.apply(.started(fileId: fileId))
            plan.apply(.completed(fileId: fileId, status: 200, bytes: 1000, sha256: nil))
        }
        // The fifth burns its attempts on transient transport failures.
        for _ in 0 ..< DownloadPlan.maxAttempts {
            plan.apply(.started(fileId: 104))
            plan.apply(.transportFailed(fileId: 104))
        }

        XCTAssertEqual(plan.states[104], .failed(attempts: DownloadPlan.maxAttempts))
        XCTAssertEqual(plan.progressFraction(), 0.8, accuracy: 1e-9)
        XCTAssertFalse(plan.isComplete)
        // The stall: no more work is offered, so the book sits at 80% forever.
        XCTAssertTrue(plan.nextToStart(limit: 5).isEmpty)
    }

    /// The recovery the bug needs: on reconnect (or an explicit retry) every
    /// latched chapter goes back to pending in one call, so the download can
    /// finish once the network is back — without disturbing verified or
    /// in-flight chapters.
    func testRetryFailedUnlatchesEveryFailedChapter() {
        var plan = DownloadPlan(chapters: chapters(5))
        plan.apply(.started(fileId: 100)) // stays in flight
        for fileId in [101, 102] { // verify two
            plan.apply(.started(fileId: fileId))
            plan.apply(.completed(fileId: fileId, status: 200, bytes: 1000, sha256: nil))
        }
        for fileId in [103, 104] { // latch two
            for _ in 0 ..< DownloadPlan.maxAttempts {
                plan.apply(.started(fileId: fileId))
                plan.apply(.transportFailed(fileId: fileId))
            }
        }
        XCTAssertEqual(plan.states[103], .failed(attempts: DownloadPlan.maxAttempts))
        XCTAssertEqual(plan.states[104], .failed(attempts: DownloadPlan.maxAttempts))

        plan.retryFailed()

        // Both failed chapters are offered again; the fresh attempt budget is
        // restored so a still-flaky network gets the full three tries anew.
        XCTAssertEqual(plan.states[103], .pending)
        XCTAssertEqual(plan.states[104], .pending)
        XCTAssertEqual(plan.nextToStart(limit: 5), [103, 104])
        // Untouched: in-flight and verified chapters are left alone.
        XCTAssertEqual(plan.states[100], .inFlight)
        XCTAssertEqual(plan.states[101], .verified)
        XCTAssertEqual(plan.states[102], .verified)

        // And the book can now actually complete.
        for fileId in [100, 103, 104] {
            plan.apply(.started(fileId: fileId))
            plan.apply(.completed(fileId: fileId, status: 200, bytes: 1000, sha256: nil))
        }
        XCTAssertTrue(plan.isComplete)
    }

    /// `retryFailed()` on a plan with nothing failed is a no-op.
    func testRetryFailedIsANoOpWhenNothingFailed() {
        var plan = DownloadPlan(chapters: chapters(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        plan.retryFailed()
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertEqual(plan.states[101], .pending)
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

    /// Cold start: files already on disk must come back as verified without
    /// hashing or spending retry attempts on a size mismatch.
    func testRestoredMatchingFilesAreVerified() {
        let all = chapters(2, size: 1000)
        let plan = DownloadPlan.restored(
            chapters: all,
            existingBytes: [100: 1000, 101: 1000]
        )
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertEqual(plan.states[101], .verified)
        XCTAssertTrue(plan.isComplete)
    }

    func testRestoredMissingOrWrongSizeStaysPending() {
        let all = chapters(2, size: 1000)
        let plan = DownloadPlan.restored(
            chapters: all,
            existingBytes: [100: 1000, 101: 999]
        )
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertEqual(plan.states[101], .pending)
        XCTAssertFalse(plan.isComplete)
        XCTAssertEqual(plan.nextToStart(limit: 5), [101])
    }

    func testRestoredMatchingSizeTrustsManifestHash() {
        let hashed = [
            ManifestChapter(
                index: 0, title: "C0", startSecs: 0, endSecs: 10,
                fileId: 100, sizeBytes: 1000, sha256: "abc", url: "u0"
            ),
        ]
        let plan = DownloadPlan.restored(
            chapters: hashed,
            existingBytes: [100: 1000]
        )
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertTrue(plan.isComplete)
    }
}
