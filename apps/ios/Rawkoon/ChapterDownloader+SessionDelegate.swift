import CryptoKit
import Foundation
import RawkoonKit

extension ChapterDownloader {
    private func lane(of session: URLSession) -> TransferLane {
        session.configuration.identifier != nil ? .background : .foreground
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let fileId = fileId(from: downloadTask.taskDescription) else { return }
        let lane = lane(of: session)
        journal.log("didFinishDownloadingTo file=\(fileId) lane=\(lane)")
        guard let outcome = store(downloadTask, at: location, fileId: fileId) else {
            journal.log("store returned nil file=\(fileId)")
            return
        }
        stateQueue.async {
            if self.tasks[fileId] === downloadTask {
                self.tasks.removeValue(forKey: fileId)
            }
            self.send(.finished(fileId: fileId, lane: lane, outcome: outcome))
        }
    }

    /// Moves the downloaded file into place and hashes it. Nil when the book was
    /// cancelled, so nothing lands in a directory that is being deleted.
    private func store(_ task: URLSessionDownloadTask, at location: URL, fileId: Int) -> TaskOutcome? {
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? -1
        let editionId = editionId
        guard (200 ... 299).contains(status) else {
            Log.download.error(
                "Chapter download failed: editionId=\(editionId, privacy: .public) fileId=\(fileId, privacy: .public) status=\(status, privacy: .public)"
            )
            return .rejected(status: status)
        }
        // fileById is written on stateQueue by a grant refresh; read it there too.
        let (file, cancelled) = stateQueue.sync { (fileById[fileId], isCancelled) }
        if cancelled {
            return nil
        }
        guard let file else { return .transportFailed }

        var destination = FileStore.chapterURL(editionId: editionId, fileId: fileId, ext: file.fileExtension)
        FileStore.ensureEditionDirectory(editionId)
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: destination.path) {
            try? fileManager.removeItem(at: destination)
        }
        do {
            try fileManager.moveItem(at: location, to: destination)
        } catch {
            return .moveFailed
        }
        FileStore.excludeFromBackup(&destination)
        let bytes = FileStore.size(url: destination) ?? 0
        return .stored(status: status, bytes: bytes, sha256: Self.sha256Hex(of: destination))
    }

    /// SHA-256 of a downloaded chapter, lowercase hex to match the server's digest.
    /// Read in chunks: a chapter is tens of megabytes and this runs on the delegate
    /// queue. Nil when unreadable; `DownloadPlan` then falls back to the byte count.
    static func sha256Hex(of url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            guard let chunk = try? handle.read(upToCount: 1024 * 1024), !chunk.isEmpty else { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        guard let fileId = fileId(from: task.taskDescription) else { return }
        let lane = lane(of: session)
        let editionId = editionId
        journal.log("didCompleteWithError file=\(fileId) lane=\(lane) code=\(nsError.code)")
        Log.download.error(
            """
            Chapter download failed (transport): \
            editionId=\(editionId, privacy: .public) fileId=\(fileId, privacy: .public) \
            domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public)
            """
        )
        stateQueue.async {
            if self.tasks[fileId] === task {
                self.tasks.removeValue(forKey: fileId)
            }
            self.send(.finished(fileId: fileId, lane: lane, outcome: .transportFailed))
        }
    }

    func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64,
        totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
    ) {
        guard let fileId = fileId(from: downloadTask.taskDescription) else { return }
        let lane = lane(of: session)
        stateQueue.async {
            self.send(.progress(fileId: fileId, lane: lane, written: totalBytesWritten, expected: totalBytesExpectedToWrite))
        }
    }

    func urlSession(_ invalidated: URLSession, didBecomeInvalidWithError _: Error?) {
        // The foreground session invalidates alongside it; only the background
        // identifier is waited on by `invalidatingSessions`.
        guard invalidated.configuration.identifier != nil else { return }
        let callback = stateQueue.sync { onInvalidated }
        callback?()
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession _: URLSession) {
        stateQueue.async {
            let completion = self.backgroundSessionCompletion
            self.backgroundSessionCompletion = nil
            DispatchQueue.main.async { completion?() }
        }
    }
}
