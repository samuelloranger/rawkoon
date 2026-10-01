@testable import RawkoonKit
import XCTest

final class DownloadEngineTests: XCTestCase {
    private func files(_ count: Int, size: Int = 100) -> [ManifestFile] {
        (0 ..< count).map {
            ManifestFile(
                id: 100 + $0, startSecs: Double($0) * 10, durationSecs: 10,
                sizeBytes: size, sha256: nil, url: "/f/\(100 + $0).mp3"
            )
        }
    }

    private func running(_ count: Int, foreground: Bool = true, wifi: Bool = false) -> (DownloadEngine, [EngineCommand]) {
        var engine = DownloadEngine(files: files(count), isForeground: foreground)
        engine.handle(.unmeteredWifi(wifi))
        engine.handle(.existingBackgroundTasks(fileIds: []))
        let commands = engine.handle(.start)
        return (engine, commands)
    }

    private func stored(_ size: Int = 100) -> TaskOutcome {
        .stored(status: 200, bytes: size, sha256: nil)
    }

    private func started(_ commands: [EngineCommand]) -> [Int] {
        commands.compactMap {
            if case let .startTask(id, _) = $0 {
                id
            } else {
                nil
            }
        }
    }

    // MARK: Scheduling

    func testStartsThreeInBookOrderOnCellularAndSixOnWifi() {
        let (_, cellular) = running(10)
        XCTAssertEqual(started(cellular), [100, 101, 102])
        let (_, wifi) = running(10, wifi: true)
        XCTAssertEqual(started(wifi), [100, 101, 102, 103, 104, 105])
    }

    func testNothingStartsBeforeTheLaunchListingArrives() {
        var engine = DownloadEngine(files: files(4))
        XCTAssertTrue(engine.handle(.start).isEmpty)
        XCTAssertEqual(started(engine.handle(.existingBackgroundTasks(fileIds: []))), [100, 101, 102])
    }

    func testAFinishedChapterFreesItsSlotForTheNextOne() {
        var (engine, _) = running(10)
        let commands = engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        XCTAssertEqual(started(commands), [103])
        XCTAssertEqual(engine.activeFileIds, [101, 102, 103])
    }

    func testSwitchingToWifiRaisesTheCapAndPumpsMore() {
        var (engine, _) = running(10)
        XCTAssertEqual(started(engine.handle(.unmeteredWifi(true))), [103, 104, 105])
    }

    func testExistingBackgroundTasksTakeSlotsAndSkipVerifiedChapters() {
        var engine = DownloadEngine(files: files(6), isForeground: false)
        engine.handle(.reconcile(onDiskBytes: [100: 100], liveFileIds: []))
        engine.handle(.start)
        let commands = engine.handle(.existingBackgroundTasks(fileIds: [100, 101]))
        XCTAssertEqual(engine.activeFileIds, [101, 102, 103])
        XCTAssertEqual(started(commands), [102, 103])
        XCTAssertEqual(engine.lane(of: 101), .background)
    }

    // MARK: Atomic completion and monotonic progress

    func testCompletionMovesPlanAndProgressInOneSnapshot() {
        var (engine, _) = running(2)
        engine.handle(.progress(fileId: 100, lane: .foreground, written: 100, expected: 100))
        let mid = engine.snapshot
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        let after = engine.snapshot
        XCTAssertEqual(after.plan.states[100], .verified)
        XCTAssertNil(after.chapterFractions[100])
        XCTAssertGreaterThanOrEqual(after.overallFraction, mid.overallFraction)
        XCTAssertGreaterThan(after.revision, mid.revision)
    }

    func testProgressNeverGoesBackwardsAcrossACancelledTransfer() {
        var (engine, _) = running(4)
        engine.handle(.progress(fileId: 100, lane: .foreground, written: 90, expected: 100))
        let high = engine.snapshot.overallFraction
        engine.handle(.appForeground(false))
        XCTAssertGreaterThanOrEqual(engine.snapshot.overallFraction, high)
    }

    func testAPerChapterFractionNeverShrinks() {
        var (engine, _) = running(2)
        engine.handle(.progress(fileId: 100, lane: .foreground, written: 80, expected: 100))
        engine.handle(.progress(fileId: 100, lane: .foreground, written: 30, expected: 100))
        XCTAssertEqual(engine.snapshot.chapterFractions[100] ?? 0, 0.8, accuracy: 0.0001)
    }

    func testProgressOnlyChangesLeaveStructureRevisionAlone() {
        var (engine, _) = running(2)
        let structure = engine.structureRevision
        engine.handle(.progress(fileId: 100, lane: .foreground, written: 10, expected: 100))
        XCTAssertEqual(engine.structureRevision, structure)
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        XCTAssertGreaterThan(engine.structureRevision, structure)
    }

    // MARK: Stale and duplicate events

    func testLateProgressAfterCompletionDoesNotResurrectTheTransfer() {
        var (engine, _) = running(2)
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        engine.handle(.progress(fileId: 100, lane: .foreground, written: 50, expected: 100))
        XCTAssertNil(engine.snapshot.chapterFractions[100])
        XCTAssertFalse(engine.activeFileIds.contains(100))
    }

    func testDuplicateCompletionCountsOnce() {
        var (engine, _) = running(3)
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        XCTAssertEqual(engine.plan.states.values.filter { $0 == .verified }.count, 1)
    }

    func testALateTransportErrorCannotDemoteAVerifiedChapter() {
        var (engine, _) = running(3)
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        engine.handle(.finished(fileId: 100, lane: .background, outcome: .transportFailed))
        XCTAssertEqual(engine.plan.states[100], .verified)
    }

    // MARK: Hand-off between lanes

    func testBackgroundingCancelsForegroundTransfersAndRestartsThemOnTheBackgroundLane() {
        var (engine, _) = running(6)
        let commands = engine.handle(.appForeground(false))
        XCTAssertEqual(commands.filter {
            if case .cancelTask = $0 {
                true
            } else {
                false
            }
        }.count, 3)
        XCTAssertEqual(started(commands), [100, 101, 102])
        XCTAssertTrue(commands.contains(.startTask(fileId: 100, lane: .background)))
        XCTAssertEqual(engine.lane(of: 100), .background)
    }

    func testHandOffSpendsNoRetryAttempt() {
        var (engine, _) = running(3)
        engine.handle(.appForeground(false))
        XCTAssertEqual(engine.plan.states[100], .inFlight)
        XCTAssertFalse(engine.plan.hasGivenUp)
    }

    func testACompletionFromACancelledForegroundTaskIsIgnored() {
        var (engine, _) = running(3)
        engine.handle(.appForeground(false))
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: .transportFailed))
        XCTAssertEqual(engine.lane(of: 100), .background)
        XCTAssertEqual(engine.plan.states[100], .inFlight)
    }

    func testReturningToTheAppUsesTheForegroundLaneForNewChapters() {
        var (engine, _) = running(8, foreground: false)
        engine.handle(.appForeground(true))
        let commands = engine.handle(.finished(fileId: 100, lane: .background, outcome: stored()))
        XCTAssertEqual(commands, [.startTask(fileId: 103, lane: .foreground)])
    }

    // MARK: Recovery

    func testALostCompletionIsRecoveredFromTheDiskAndFreesItsSlot() {
        var (engine, _) = running(5)
        let commands = engine.handle(.reconcile(onDiskBytes: [100: 100], liveFileIds: [101, 102]))
        XCTAssertEqual(engine.plan.states[100], .verified)
        XCTAssertFalse(engine.activeFileIds.contains(100))
        XCTAssertEqual(started(commands), [103])
    }

    func testALeakedSlotIsFreedAndTheChapterRequeuedWhenNothingIsOnDisk() {
        var (engine, _) = running(5)
        let commands = engine.handle(.reconcile(onDiskBytes: [:], liveFileIds: [101, 102]))
        XCTAssertEqual(started(commands), [100])
        XCTAssertEqual(engine.activeFileIds, [100, 101, 102])
    }

    func testReconcileLeavesLiveTransfersAlone() {
        var (engine, _) = running(3)
        let commands = engine.handle(.reconcile(onDiskBytes: [:], liveFileIds: [100, 101, 102]))
        XCTAssertTrue(commands.isEmpty)
        XCTAssertEqual(engine.activeFileIds, [100, 101, 102])
    }

    func testAPartialFileOnDiskIsNotTreatedAsComplete() {
        var (engine, _) = running(3)
        engine.handle(.reconcile(onDiskBytes: [100: 40], liveFileIds: [101, 102]))
        XCTAssertNotEqual(engine.plan.states[100], .verified)
    }

    func testIdleReconcileIsOfferedNearTheEndAtMostThreeTimesPerStall() {
        var (engine, _) = running(2)
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored()))
        XCTAssertTrue(engine.wantsIdleReconcile)
        XCTAssertTrue(engine.consumeIdleReconcile())
        XCTAssertTrue(engine.consumeIdleReconcile())
        XCTAssertTrue(engine.consumeIdleReconcile())
        XCTAssertFalse(engine.consumeIdleReconcile())
    }

    // MARK: Failures and grants

    func testASizeMismatchDeletesTheFileAndRetriesTheChapter() {
        var (engine, _) = running(3)
        let commands = engine.handle(.finished(fileId: 100, lane: .foreground, outcome: .stored(status: 200, bytes: 60, sha256: nil)))
        XCTAssertTrue(commands.contains(.deleteFile(fileId: 100)))
        XCTAssertTrue(commands.contains(.startTask(fileId: 100, lane: .foreground)) || engine.plan.states[100] != .verified)
        XCTAssertNotEqual(engine.plan.states[100], .verified)
    }

    func testAChapterGivesUpAfterThreeFailures() {
        var (engine, _) = running(1)
        for _ in 0 ..< 3 {
            engine.handle(.finished(fileId: 100, lane: .foreground, outcome: .transportFailed))
        }
        XCTAssertTrue(engine.plan.hasGivenUp)
        XCTAssertTrue(engine.activeFileIds.isEmpty)
        XCTAssertEqual(started(engine.handle(.retryFailed)), [100])
    }

    func testAnExpiredGrantPausesStartingUntilRefreshed() {
        var (engine, _) = running(6)
        engine.handle(.finished(fileId: 100, lane: .foreground, outcome: .rejected(status: 401)))
        XCTAssertTrue(engine.plan.needsFreshGrants)
        XCTAssertTrue(engine.handle(.finished(fileId: 101, lane: .foreground, outcome: stored())).isEmpty)
        XCTAssertFalse(started(engine.handle(.grantsRefreshed)).isEmpty)
    }

    func testReplacedFilesCancelOldTransfersAndStartOver() {
        var (engine, _) = running(4)
        let newFiles = (0 ..< 3).map {
            ManifestFile(id: 500 + $0, startSecs: Double($0), durationSecs: 1, sizeBytes: 50, sha256: nil, url: "/n/\($0)")
        }
        let commands = engine.handle(.replaceFiles(newFiles))
        XCTAssertEqual(commands.filter {
            if case .cancelTask = $0 {
                true
            } else {
                false
            }
        }.count, 3)
        XCTAssertEqual(started(commands), [500, 501, 502])
        XCTAssertEqual(engine.snapshot.overallFraction, 0, accuracy: 0.0001)
    }

    func testCancelStopsEverythingAndIgnoresLaterEvents() {
        var (engine, _) = running(4)
        let commands = engine.handle(.cancel)
        XCTAssertEqual(commands.count, 3)
        XCTAssertTrue(engine.handle(.finished(fileId: 100, lane: .foreground, outcome: stored())).isEmpty)
        XCTAssertNotEqual(engine.plan.states[100], .verified)
    }

    // MARK: Whole-book simulation

    private struct SeededRandom {
        var state: UInt64
        mutating func next(_ bound: Int) -> Int {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((state >> 33) % UInt64(bound))
        }
    }

    func testSixtySixChaptersFinishInAnyOrderWithNoDipAndNoStall() {
        for seed in 1 ... 25 {
            var random = SeededRandom(state: UInt64(seed))
            var (engine, _) = running(66, wifi: true)
            var lastFraction = 0.0
            var lastRevision = 0
            var steps = 0
            while !engine.plan.isComplete, steps < 5000 {
                steps += 1
                let live = engine.activeFileIds.sorted()
                guard !live.isEmpty else { break }
                let fileId = live[random.next(live.count)]
                let lane = engine.lane(of: fileId) ?? .foreground
                switch random.next(10) {
                case 0 ..< 5:
                    engine.handle(.progress(fileId: fileId, lane: lane, written: Int64(random.next(101)), expected: 100))
                case 5 ..< 9:
                    engine.handle(.progress(fileId: fileId, lane: lane, written: 100, expected: 100))
                    engine.handle(.finished(fileId: fileId, lane: lane, outcome: stored()))
                    // A stale duplicate and a late progress tick must change nothing.
                    engine.handle(.finished(fileId: fileId, lane: lane, outcome: stored()))
                    engine.handle(.progress(fileId: fileId, lane: lane, written: 50, expected: 100))
                default:
                    engine.handle(.appForeground(random.next(2) == 0))
                }
                let snapshot = engine.snapshot
                XCTAssertGreaterThanOrEqual(snapshot.overallFraction, lastFraction, "seed \(seed) dipped")
                XCTAssertGreaterThanOrEqual(snapshot.revision, lastRevision)
                XCTAssertLessThanOrEqual(engine.activeFileIds.count, DownloadEngine.wifiConcurrency)
                lastFraction = snapshot.overallFraction
                lastRevision = snapshot.revision
            }
            XCTAssertTrue(engine.plan.isComplete, "seed \(seed) stalled")
            XCTAssertEqual(engine.snapshot.overallFraction, 1, accuracy: 0.0001)
            XCTAssertTrue(engine.activeFileIds.isEmpty)
        }
    }
}
