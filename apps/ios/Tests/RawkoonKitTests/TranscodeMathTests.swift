import Foundation
@testable import RawkoonKit
import Testing

struct TranscodeMathTests {
    @Test func targetKbpsSubtractsAudioAndSpreadsOverDuration() {
        // 2 files × 1.5 GB, 100 MB audio, 2 h total → (3e9 − 1e8) × 8 / 7200 / 1000
        #expect(TranscodeMath.targetKbps(gbPerFile: 1.5, fileCount: 2, totalAudioBytes: 100_000_000, totalDurationSecs: 7200) == 3222)
    }

    @Test func targetKbpsFloorsAt100() {
        #expect(TranscodeMath.targetKbps(gbPerFile: 0.01, fileCount: 1, totalAudioBytes: 100_000_000, totalDurationSecs: 3600) == 100)
        #expect(TranscodeMath.targetKbps(gbPerFile: 2, fileCount: 1, totalAudioBytes: 0, totalDurationSecs: 0) == 100)
    }

    @Test func fitsBoxChecksBothSides() {
        #expect(TranscodeMath.fitsBox(sourceWidth: 1920, sourceHeight: 1080, boxWidth: 1920, boxHeight: 1080))
        #expect(!TranscodeMath.fitsBox(sourceWidth: 2560, sourceHeight: 1072, boxWidth: 1920, boxHeight: 1080))
        #expect(!TranscodeMath.fitsBox(sourceWidth: 3840, sourceHeight: 2160, boxWidth: 1920, boxHeight: 1080))
        #expect(TranscodeMath.fitsBox(sourceWidth: nil, sourceHeight: 720, boxWidth: 1280, boxHeight: 720))
        #expect(!TranscodeMath.fitsBox(sourceWidth: nil, sourceHeight: nil, boxWidth: 1280, boxHeight: 720))
    }

    @Test func hhmmRoundTrips() {
        #expect(TranscodeMath.minutes(fromHHMM: "01:30") == 90)
        #expect(TranscodeMath.minutes(fromHHMM: "23:59") == 1439)
        #expect(TranscodeMath.minutes(fromHHMM: "24:00") == nil)
        #expect(TranscodeMath.minutes(fromHHMM: "7:5") == nil)
        #expect(TranscodeMath.hhmm(fromMinutes: 90) == "01:30")
        #expect(TranscodeMath.hhmm(fromMinutes: 0) == "00:00")
        #expect(TranscodeMath.hhmm(fromMinutes: 1500) == "01:00")
    }

    @Test func stepIndexOrdersPipelineSteps() {
        #expect(TranscodeMath.stepIndex("encode") == 0)
        #expect(TranscodeMath.stepIndex("rescan") == 3)
        #expect(TranscodeMath.stepIndex("preflight") == nil)
        #expect(TranscodeMath.stepIndex(nil) == nil)
    }

    @Test func moveDownPlacesAfterNewPredecessor() throws {
        // [1,2,3,4]: drag 1 to between 3 and 4 → SwiftUI destination 3
        let r = try #require(TranscodeMath.movePlacement(ids: [1, 2, 3, 4], from: IndexSet(integer: 0), to: 3))
        #expect(r.id == 1)
        #expect(r.placement == .after(3))
    }

    @Test func moveUpPlacesAfterNewPredecessor() throws {
        let r = try #require(TranscodeMath.movePlacement(ids: [1, 2, 3, 4], from: IndexSet(integer: 3), to: 1))
        #expect(r.id == 4)
        #expect(r.placement == .after(1))
    }

    @Test func moveToFirstSlotIsBeforeNeighbourNotTop() throws {
        let r = try #require(TranscodeMath.movePlacement(ids: [5, 6, 7], from: IndexSet(integer: 2), to: 0))
        #expect(r.id == 7)
        #expect(r.placement == .before(5))
    }

    @Test func noOpAndInvalidMovesReturnNil() {
        #expect(TranscodeMath.movePlacement(ids: [1, 2, 3], from: IndexSet(integer: 1), to: 1) == nil)
        #expect(TranscodeMath.movePlacement(ids: [1, 2, 3], from: IndexSet(integer: 1), to: 2) == nil)
        #expect(TranscodeMath.movePlacement(ids: [1], from: IndexSet(integer: 0), to: 1) == nil)
        #expect(TranscodeMath.movePlacement(ids: [1, 2, 3], from: IndexSet([0, 1]), to: 3) == nil)
    }
}
