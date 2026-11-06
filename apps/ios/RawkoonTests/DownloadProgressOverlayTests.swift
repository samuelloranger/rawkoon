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

    @Test func overlayKeepsLastSwarmCountsWhenPushOmitsThem() {
        let known = LiveDownload(
            progress: 0.2, downloadSpeed: 1000, etaSeconds: nil, state: "downloading", seeds: 9, peers: 3
        )
        let overlaid = overlayDownloadProgress([row(id: 1, live: known)], progress: [1: live(0.5)])
        #expect(overlaid[0].live?.progress == 0.5)
        #expect(overlaid[0].live?.seeds == 9)
        #expect(overlaid[0].live?.peers == 3)
    }

    @Test func overlayTakesPushedSwarmCountsAndKeepsReleaseDetails() {
        var base = row(id: 1, live: live(0.2))
        base.sizeBytes = 4_000_000_000
        base.qualityParsed = ParsedQuality(resolution: 2160, source: "WEB-DL", codec: "x265", hdr: "DV")
        let pushed = LiveDownload(
            progress: 0.6, downloadSpeed: 1000, etaSeconds: nil, state: "downloading", seeds: 20, peers: 1
        )
        let overlaid = overlayDownloadProgress([base], progress: [1: pushed])
        #expect(overlaid[0].live?.seeds == 20)
        #expect(overlaid[0].live?.peers == 1)
        #expect(overlaid[0].sizeBytes == 4_000_000_000)
        #expect(overlaid[0].qualityParsed?.resolution == 2160)
        #expect(overlaid[0].qualityParsed?.hdr == "DV")
    }

    @Test func historyItemDecodesReleaseDetails() throws {
        let json = #"""
        {"id":3,"release_title":"r","indexer":"idx","grabbed_at":"2026-01-01T00:00:00Z","completed_at":null,
         "failed":false,"size_bytes":1500000000,
         "quality_parsed":{"resolution":1080,"source":"BluRay","codec":"x264","hdr":null},
         "live":{"progress":0.5,"download_speed":10,"eta_seconds":null,"state":"downloading","seeds":7,"peers":2}}
        """#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let item = try decoder.decode(DownloadHistoryItem.self, from: Data(json.utf8))
        #expect(item.sizeBytes == 1_500_000_000)
        #expect(item.qualityParsed?.resolution == 1080)
        #expect(item.qualityParsed?.hdr == nil)
        #expect(item.live?.seeds == 7)
        #expect(item.live?.peers == 2)
    }

    @Test func historyItemDecodesWithoutReleaseDetails() throws {
        let json = #"{"id":3,"release_title":"r","grabbed_at":"","failed":false}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let item = try decoder.decode(DownloadHistoryItem.self, from: Data(json.utf8))
        #expect(item.sizeBytes == nil)
        #expect(item.qualityParsed == nil)
    }
}
