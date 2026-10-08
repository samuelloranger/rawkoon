import AVFoundation
import Foundation
import RawkoonKit

/// Failure recovery: how a chapter that will not open or stream is resolved.
extension AudiobookPlayer {
    /// An emptied queue is a failed item when the item failed; only otherwise
    /// is it the end of the book.
    func handleQueueEmptied() {
        if let item = queuedItem, item.status == .failed || item.error != nil {
            handleFailedItem(item)
            return
        }
        applyQueueDrained()
    }

    /// The one place a failed item is resolved: a local copy that will not
    /// open streams instead, a failed stream retries with fresh URLs, and only
    /// then does playback stop, saying why.
    func handleFailedItem(_ item: AVPlayerItem) {
        let identifier = ObjectIdentifier(item)
        guard handledFailedItem != identifier else { return }
        handledFailedItem = identifier
        logItemFailure(item)
        guard let file = file(for: item) else {
            reportUnplayableFile(nil, reason: .unreadable)
            return
        }
        let isLocal = (item.asset as? AVURLAsset)?.url.isFileURL ?? false
        let action = playbackFailureAction(
            isLocalFile: isLocal,
            localAlreadyFailed: recoveredFileIds.contains(file.id),
            secondsSinceStreamRetry: streamRetriedAt[file.id].map { Date().timeIntervalSince($0) },
            isOnline: isNetworkAvailable()
        )
        switch action {
        case .streamInstead:
            // Keeps the file: the failure may be transient and it may be the
            // only offline copy. `recoveredFileIds` caps this to once a session.
            recoveredFileIds.insert(file.id)
            Log.playback.error(
                """
                Local file failed to open; streaming this session and keeping the \
                file: fileId=\(file.id, privacy: .public)
                """
            )
            buildQueue(at: positionSecs, autoplay: isPlaying)
        case .refreshAndRetry:
            streamRetriedAt[file.id] = Date()
            retryStream(fileId: file.id)
        case let .stop(reason):
            reportUnplayableFile(file, reason: reason)
        }
    }

    /// Rebuilds from the current position once fresh URLs are in. When none
    /// come back the same URL still gets its one retry: a dropped signal
    /// recovers on its own.
    func retryStream(fileId: Int) {
        guard let editionId = manifest?.editionId else { return }
        // Supersedes pending seek completions; a seek or load during the
        // refresh bumps it again and abandons this retry.
        seekID += 1
        let id = seekID
        streamRetryPending = true
        Log.playback.error(
            """
            Stream failed; retrying with fresh URLs: \
            fileId=\(fileId, privacy: .public)
            """
        )
        Task { [weak self] in
            let fresh = await self?.refreshManifest?(editionId)
            guard let self, seekID == id, manifest?.editionId == editionId else { return }
            // Stamped again on completion: a refresh that hung until the window
            // passed must not open the way to another retry.
            streamRetriedAt[fileId] = Date()
            if let fresh {
                adoptRefreshedManifest(fresh)
            }
            buildQueue(at: positionSecs, autoplay: isPlaying)
        }
    }

    /// Swaps in a fresher manifest's signed URLs for the book already loaded,
    /// without touching playback. A different file set is a re-import, which
    /// is a reload rather than a refresh, so it is ignored here.
    @discardableResult
    func adoptRefreshedManifest(_ fresh: BookManifest) -> Bool {
        guard let manifest, manifest.editionId == fresh.editionId,
              sameFileLayout(manifest.files, fresh.files)
        else { return false }
        self.manifest = fresh
        filesById = Dictionary(uniqueKeysWithValues: fresh.files.map { ($0.id, $0) })
        return true
    }

    /// Names the real cause: "couldn't be played" read as a corrupt chapter
    /// when the cause was an expired link or no signal.
    func unplayableMessage(title: String, reason: PlaybackStopReason?) -> String {
        if title.isEmpty {
            return String(localized: "The next chapter couldn't be played. Playback stopped.")
        }
        switch reason {
        case .offline:
            return String(localized: "\"\(title)\" needs a connection and you're offline. Playback stopped.")
        case .streamFailed:
            return String(localized: "Couldn't stream \"\(title)\" from the server. Check your connection and try again.")
        case .unreadable:
            return String(localized: "\"\(title)\" couldn't be read on this device. Playback stopped.")
        case nil:
            return String(localized: "\"\(title)\" couldn't be played. Playback stopped.")
        }
    }

    /// A player item that fails is the end of the road for that file.
    /// We stop and surface an error rather than walking the playlist.
    func logItemFailure(_ item: AVPlayerItem) {
        let fileId = file(for: item)?.id ?? -1
        let reason = item.error?.localizedDescription ?? "no error reported"
        Log.playback.error(
            """
            File item failed to load: \
            fileId=\(fileId, privacy: .public) \
            error=\(reason, privacy: .public)
            """
        )
    }

    /// Local chapters are `<fileId>.bin` (grant URLs carry no extension), and
    /// AVFoundation picks its parser by extension, so a local file gets its
    /// sniffed type spelled out or it fails with "Cannot Open".
    func makePlayerItem(url: URL) -> AVPlayerItem {
        // Only the extensionless `.bin` name needs it; a real extension opens as is.
        guard url.isFileURL, url.pathExtension == "bin",
              let mimeType = FileStore.audioMIMEType(url: url)
        else {
            return AVPlayerItem(url: url)
        }
        return AVPlayerItem(asset: AVURLAsset(url: url, options: [AVURLAssetOverrideMIMETypeKey: mimeType]))
    }
}
