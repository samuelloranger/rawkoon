@testable import Rawkoon
import RawkoonKit
import Testing

@MainActor
struct AppModelDownloadRegressionTests {
    @Test func lateSnapshotCannotRecreateCancelledDownload() {
        let model = AppModel()
        let editionId = 987_654_324
        let file = ManifestFile(
            id: 1, startSecs: 0, durationSecs: 60,
            sizeBytes: 100, sha256: nil, url: "https://rawkoon.example/chapter"
        )
        let snapshot = DownloadEngine(files: [file]).snapshot
        model.verifiedCounts[editionId] = 0

        model.applyDownloadSnapshot(snapshot, editionId: editionId)

        #expect(model.downloadPlans[editionId] == nil)
        #expect(model.chapterFractions[editionId] == nil)
        #expect(model.downloadFractions[editionId] == nil)
        #expect(model.verifiedCounts[editionId] == 0)
    }
}
