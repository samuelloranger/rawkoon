@testable import RawkoonKit
import XCTest

final class DownloadPlanTests: XCTestCase {
    private func files(_ n: Int, size: Int = 1000) -> [ManifestFile] {
        (0 ..< n).map { i in
            ManifestFile(id: 100 + i, startSecs: Double(i) * 10,
                         durationSecs: 10, sizeBytes: size, sha256: nil, url: "u\(i)")
        }
    }

    func testStartsPendingAndOffersWorkUpToTheLimit() {
        let plan = DownloadPlan(files: files(5))
        XCTAssertEqual(plan.nextToStart(limit: 2), [100, 101])
        XCTAssertFalse(plan.isComplete)
    }

    func testASuccessfulCompletionVerifies() {
        var plan = DownloadPlan(files: files(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertTrue(plan.isComplete)
    }

    /// A background download task reports success for ANY response the server
    /// sent, including an error page. Status must be checked before the bytes
    /// are trusted, or a 401 body lands in the file as if it were audio.
    func testAnErrorStatusIsNotSuccess() {
        var plan = DownloadPlan(files: files(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 500, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
        XCTAssertFalse(plan.isComplete)
    }

    /// 401 is not a failure of the file, it is an expired grant. The file
    /// goes back to pending and the caller is told to refetch the manifest.
    func testExpiredGrantRequeuesWithoutConsumingAnAttempt() {
        var plan = DownloadPlan(files: files(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 401, bytes: 52, sha256: nil))
        XCTAssertEqual(plan.states[100], .pending)
        XCTAssertTrue(plan.needsFreshGrants)
        XCTAssertTrue(plan.nextToStart(limit: 5).contains(100))
    }

    func testWrongByteCountIsAFailure() {
        var plan = DownloadPlan(files: files(1, size: 1000))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 52, sha256: nil))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
    }

    func testMismatchedHashIsAFailure() {
        let f = [ManifestFile(id: 100, startSecs: 0, durationSecs: 10,
                              sizeBytes: 1000, sha256: "expected", url: "u")]
        var plan = DownloadPlan(files: f)
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: "different"))
        XCTAssertEqual(plan.states[100], .failed(attempts: 1))
    }

    func testGivesUpAfterMaxAttempts() {
        var plan = DownloadPlan(files: files(1))
        for _ in 0 ..< DownloadPlan.maxAttempts {
            plan.apply(.started(fileId: 100))
            plan.apply(.transportFailed(fileId: 100))
        }
        XCTAssertEqual(plan.states[100], .failed(attempts: DownloadPlan.maxAttempts))
        XCTAssertTrue(plan.nextToStart(limit: 5).isEmpty)
    }

    func testInFlightFilesAreNotOfferedAgain() {
        var plan = DownloadPlan(files: files(3))
        plan.apply(.started(fileId: 100))
        XCTAssertEqual(plan.nextToStart(limit: 3), [101, 102])
    }

    func testProgressFraction() {
        var plan = DownloadPlan(files: files(4))
        XCTAssertEqual(plan.progressFraction(), 0, accuracy: 1e-9)
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        XCTAssertEqual(plan.progressFraction(), 0.25, accuracy: 1e-9)
    }

    func testEviction() {
        var plan = DownloadPlan(files: files(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        plan.apply(.evicted(fileId: 100))
        XCTAssertEqual(plan.states[100], .evicted)
        XCTAssertFalse(plan.isComplete)
    }

    func testRequestedResetsFailedFileBackToPending() {
        var plan = DownloadPlan(files: files(1))
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

    func testRequestedResetsEvictedFileBackToPending() {
        var plan = DownloadPlan(files: files(1))
        plan.apply(.evicted(fileId: 100))
        XCTAssertEqual(plan.states[100], .evicted)

        plan.apply(.requested(fileId: 100))
        XCTAssertEqual(plan.states[100], .pending)
        XCTAssertEqual(plan.nextToStart(limit: 5), [100])
    }

    // MARK: - Transient-failure stall + recovery (bug: 98% stuck forever)

    /// Reproduces the "stuck at 98%" report. A flaky network fails one file
    /// `maxAttempts` times while the rest verify. The plan then latches: the
    /// failed file is never offered again, so `isComplete` can never become
    /// true even though only transient network blips — not the file — were
    /// ever wrong. Nothing in a live session recovers it.
    func testOneTransientlyFailedFileStallsTheWholeBookForever() {
        var plan = DownloadPlan(files: files(5))
        // Four files verify.
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
    /// latched file goes back to pending in one call, so the download can
    /// finish once the network is back — without disturbing verified or
    /// in-flight files.
    func testRetryFailedUnlatchesEveryFailedFile() {
        var plan = DownloadPlan(files: files(5))
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

        // Both failed files are offered again; the fresh attempt budget is
        // restored so a still-flaky network gets the full three tries anew.
        XCTAssertEqual(plan.states[103], .pending)
        XCTAssertEqual(plan.states[104], .pending)
        XCTAssertEqual(plan.nextToStart(limit: 5), [103, 104])
        // Untouched: in-flight and verified files are left alone.
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
        var plan = DownloadPlan(files: files(2))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 200, bytes: 1000, sha256: nil))
        plan.retryFailed()
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertEqual(plan.states[101], .pending)
    }

    /// The flag has to clear, or every later emission re-triggers a refetch.
    func testAcknowledgingFreshGrantsClearsTheFlag() {
        var plan = DownloadPlan(files: files(1))
        plan.apply(.started(fileId: 100))
        plan.apply(.completed(fileId: 100, status: 401, bytes: 0, sha256: nil))
        XCTAssertTrue(plan.needsFreshGrants)

        plan.acknowledgeFreshGrants()

        XCTAssertFalse(plan.needsFreshGrants)
        // The file is still queued, not failed.
        XCTAssertEqual(plan.states[100], .pending)
    }

    /// Cold start: files already on disk must come back as verified without
    /// hashing or spending retry attempts on a size mismatch.
    func testRestoredMatchingFilesAreVerified() {
        let all = files(2, size: 1000)
        let plan = DownloadPlan.restored(
            files: all,
            existingBytes: [100: 1000, 101: 1000]
        )
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertEqual(plan.states[101], .verified)
        XCTAssertTrue(plan.isComplete)
    }

    func testRestoredMissingOrWrongSizeStaysPending() {
        let all = files(2, size: 1000)
        let plan = DownloadPlan.restored(
            files: all,
            existingBytes: [100: 1000, 101: 999]
        )
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertEqual(plan.states[101], .pending)
        XCTAssertFalse(plan.isComplete)
        XCTAssertEqual(plan.nextToStart(limit: 5), [101])
    }

    func testRestoredMatchingSizeTrustsManifestHash() {
        let hashed = [
            ManifestFile(id: 100, startSecs: 0, durationSecs: 10,
                         sizeBytes: 1000, sha256: "abc", url: "u0"),
        ]
        let plan = DownloadPlan.restored(
            files: hashed,
            existingBytes: [100: 1000]
        )
        XCTAssertEqual(plan.states[100], .verified)
        XCTAssertTrue(plan.isComplete)
    }

    /// A single-file audiobook is one download unit even though it has many
    /// chapters. The plan is built from files, so there are no duplicate keys
    /// and the one file is offered exactly once.
    func testSingleFileEditionIsOneDownloadUnit() {
        let single = [ManifestFile(id: 1059, startSecs: 0, durationSecs: 400,
                                   sizeBytes: 500, sha256: nil, url: "u")]
        var plan = DownloadPlan(files: single)
        XCTAssertEqual(plan.files.count, 1)
        XCTAssertEqual(plan.nextToStart(limit: 5), [1059])
        plan.apply(.started(fileId: 1059))
        plan.apply(.completed(fileId: 1059, status: 200, bytes: 500, sha256: nil))
        XCTAssertTrue(plan.isComplete)
        XCTAssertEqual(plan.progressFraction(), 1, accuracy: 1e-9)
    }
}
