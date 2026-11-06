import Foundation

// Pure helpers for server-pushed live download progress (the `.downloadProgress`
// SSE event). Kept free of view/model state so they unit-test without a running
// app: `AppModel` builds the per-media map, `MediaDetailView` overlays it.

/// Collapse pushed entries into a `downloadId → live` map, newest wins.
nonisolated func downloadProgressMap(_ items: [DownloadProgressEntry]) -> [Int: LiveDownload] {
    var map: [Int: LiveDownload] = [:]
    for item in items {
        map[item.id] = item.live
    }
    return map
}

/// Overlay pushed live progress onto the rows the view already holds, keyed by
/// id. A row with no pushed entry is returned unchanged. Never reorders.
/// Seeds/peers missing from a push (older servers) keep the row's last known counts.
nonisolated func overlayDownloadProgress(
    _ rows: [DownloadHistoryItem],
    progress: [Int: LiveDownload]
) -> [DownloadHistoryItem] {
    guard !progress.isEmpty else { return rows }
    return rows.map { row in
        guard let pushed = progress[row.id] else { return row }
        let live = LiveDownload(
            progress: pushed.progress,
            downloadSpeed: pushed.downloadSpeed,
            etaSeconds: pushed.etaSeconds,
            state: pushed.state,
            seeds: pushed.seeds ?? row.live?.seeds,
            peers: pushed.peers ?? row.live?.peers
        )
        return DownloadHistoryItem(
            id: row.id,
            releaseTitle: row.releaseTitle,
            indexer: row.indexer,
            grabbedAt: row.grabbedAt,
            completedAt: row.completedAt,
            failed: row.failed,
            episodeId: row.episodeId,
            failReason: row.failReason,
            postProcessError: row.postProcessError,
            postProcessDestinationPath: row.postProcessDestinationPath,
            live: live,
            aiPicked: row.aiPicked,
            sizeBytes: row.sizeBytes,
            qualityParsed: row.qualityParsed
        )
    }
}
