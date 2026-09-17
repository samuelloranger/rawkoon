import Foundation
@testable import Rawkoon
import Testing

struct DownloadProgressOverlayTests {
    private func row(id: Int, live: LiveDownload? = nil) -> DownloadHistoryItem {
        DownloadHistoryItem(
            id: id,
            releaseTitle: "release \(id)",
            indexer: nil,
            grabbedAt: "2026-01-01T00:00:00Z",
            completedAt: nil,
            failed: false,
            episodeId: nil,
            failReason: nil,
            postProcessError: nil,
            postProcessDestinationPath: nil,
            live: live,
            aiPicked: nil
        )
    }

    private func live(_ progress: Double, _ state: String = "downloading") -> LiveDownload {
        LiveDownload(progress: progress, downloadSpeed: 1000, etaSeconds: nil, state: state)
    }

    @Test func mapKeepsNewestPerId() {
        let entries = [
            DownloadProgressEntry(id: 1, live: live(0.2)),
            DownloadProgressEntry(id: 2, live: live(0.5)),
            DownloadProgressEntry(id: 1, live: live(0.9)),
        ]
        let map = downloadProgressMap(entries)
        #expect(map.count == 2)
        #expect(map[1]?.progress == 0.9)
        #expect(map[2]?.progress == 0.5)
    }

    @Test func overlayReplacesLiveOnMatchingRowsOnly() {
        let rows = [row(id: 1, live: live(0.1)), row(id: 2)]
        let overlaid = overlayDownloadProgress(rows, progress: [1: live(0.8, "stalled")])
        #expect(overlaid[0].live?.progress == 0.8)
        #expect(overlaid[0].live?.state == "stalled")
        #expect(overlaid[1].live == nil)
    }

    @Test func overlayPreservesOrderAndOtherFields() {
        let rows = [row(id: 5, live: live(0.3)), row(id: 6), row(id: 7)]
        let overlaid = overlayDownloadProgress(rows, progress: [7: live(0.4)])
        #expect(overlaid.map(\.id) == [5, 6, 7])
        #expect(overlaid[0].releaseTitle == "release 5")
        #expect(overlaid[2].live?.progress == 0.4)
    }

    @Test func emptyProgressReturnsRowsUnchanged() {
        let rows = [row(id: 1, live: live(0.3))]
        let overlaid = overlayDownloadProgress(rows, progress: [:])
        #expect(overlaid.count == 1)
        #expect(overlaid[0].live?.progress == 0.3)
    }
}
