import XCTest
@testable import RawkoonKit

final class SyncReconcilerTests: XCTestCase {
    private func rec(_ pos: Double, _ at: Int64, total: Double = 1000, finished: Bool = false) -> ProgressRecord {
        ProgressRecord(positionSecs: pos, totalDurationSecs: total, finished: finished, updatedAtMillis: at)
    }

    func testNewerSideWins() {
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 5), remote: rec(20, 9)), .takeRemote)
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 9), remote: rec(20, 5)), .push)
    }

    func testMissingSides() {
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 5), remote: nil), .push)
        XCTAssertEqual(SyncReconciler.reconcile(local: nil, remote: rec(10, 5)), .takeRemote)
        XCTAssertEqual(SyncReconciler.reconcile(local: nil, remote: nil), .keepLocal)
    }

    /// Equal timestamps must not ping-pong between devices.
    func testEqualTimestampsKeepLocal() {
        XCTAssertEqual(SyncReconciler.reconcile(local: rec(10, 7), remote: rec(20, 7)), .keepLocal)
    }

    /// A position recorded against a different book length is approximate. It is
    /// clamped, and must never mark the book finished - finished books are
    /// auto-evicted, so a bad clamp would delete a download mid-listen.
    func testPositionFromADifferentEditionLengthIsClampedAndNeverFinishes() {
        let stale = rec(9_000, 5, total: 10_000, finished: false)
        let adjusted = SyncReconciler.adjust(stale, toTotal: 1_000)
        XCTAssertEqual(adjusted.positionSecs, 1_000)
        XCTAssertEqual(adjusted.totalDurationSecs, 1_000)
        XCTAssertFalse(adjusted.finished)
    }

    func testMatchingTotalIsLeftAlone() {
        let r = rec(500, 5, total: 1_000, finished: true)
        XCTAssertEqual(SyncReconciler.adjust(r, toTotal: 1_000), r)
    }
}
