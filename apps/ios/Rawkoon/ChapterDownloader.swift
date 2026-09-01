import CryptoKit
import Foundation
import RawkoonKit

final class ChapterDownloader: NSObject, URLSessionDownloadDelegate {
    private let editionId: Int
    private let baseURL: URL
    private let onState: (DownloadPlan) -> Void
    private let stateQueue = DispatchQueue(label: "cloud.samlo.rawkoon.chapter-downloader")
    private let maxConcurrentDownloads = 3
    private let sessionIdentifier: String
    private let allowCellular: Bool

    /// Not `let`: an expired grant is replaced in place rather than by tearing
    /// the background session down, because the session identifier has to stay
    /// stable for `handleEventsForBackgroundURLSession` to map back to it.
    private var manifest: BookManifest
    private var chapterByFileId: [Int: ManifestChapter]
    private var plan: DownloadPlan
    private var isRunning = false
    private var hasLoadedExistingTasks = false
    private var activeFileIds: Set<Int> = []
    private var backgroundSessionCompletion: (() -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(
            withIdentifier: sessionIdentifier
        )
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.allowsCellularAccess = allowCellular
        config.allowsExpensiveNetworkAccess = allowCellular
        config.allowsConstrainedNetworkAccess = allowCellular
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    init(
        editionId: Int,
        baseURL: URL,
        manifest: BookManifest,
        allowCellular: Bool,
        onState: @escaping (DownloadPlan) -> Void
    ) {
        self.editionId = editionId
        self.baseURL = baseURL
        self.manifest = manifest
        self.allowCellular = allowCellular
        self.onState = onState
        sessionIdentifier = Self.sessionIdentifier(editionId: editionId)
        plan = DownloadPlan(chapters: manifest.chapters)
        chapterByFileId = Dictionary(uniqueKeysWithValues: manifest.chapters.map { ($0.fileId, $0) })
        super.init()
        reconcileExistingFiles()
        loadExistingTasks()
    }

    func start() {
        stateQueue.async {
            self.isRunning = true
            self.pumpIfNeeded()
        }
    }

    func requestRetry(fileId: Int) {
        stateQueue.async {
            self.plan.apply(.requested(fileId: fileId))
            self.emitState()
            self.pumpIfNeeded()
        }
    }

    func hasBackgroundSession(identifier: String) -> Bool {
        identifier == sessionIdentifier
    }

    /// Built and parsed in one place so a background launch can recover the
    /// edition from nothing but the session identifier iOS hands back.
    private static let sessionIdentifierPrefix = "cloud.samlo.rawkoon.dl."

    static func sessionIdentifier(editionId: Int) -> String {
        "\(sessionIdentifierPrefix)\(editionId)"
    }

    static func editionId(fromSessionIdentifier identifier: String) -> Int? {
        guard identifier.hasPrefix(sessionIdentifierPrefix) else { return nil }
        return Int(identifier.dropFirst(sessionIdentifierPrefix.count))
    }

    /// Swaps in freshly signed chapter URLs and lets the queue run again.
    ///
    /// A grant lasts seven days; a download paused past that, or a server whose
    /// secret rotated, gets 401/403 forever otherwise, because the plan requeues
    /// those without spending an attempt.
    func refreshChapterURLs(from manifest: BookManifest) {
        stateQueue.async {
            self.manifest = manifest
            self.chapterByFileId = Dictionary(
                uniqueKeysWithValues: manifest.chapters.map { ($0.fileId, $0) }
            )
            self.plan.acknowledgeFreshGrants()
            self.emitState()
            self.pumpIfNeeded()
        }
    }

    func setBackgroundSessionCompletion(_ completion: @escaping () -> Void) {
        stateQueue.async {
            self.backgroundSessionCompletion = completion
        }
    }

    /// A leftover file of the wrong size is discarded, not failed.
    ///
    /// Feeding it to the plan as a completed download spends a retry attempt on
    /// every launch, so three launches would permanently fail a chapter that
    /// only ever needed re-downloading. Deleting it leaves the chapter pending.
    private func reconcileExistingFiles() {
        for chapter in manifest.chapters {
            let ext = fileExtension(for: chapter)
            guard FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: ext) else { continue }
            let url = FileStore.chapterURL(editionId: editionId, fileId: chapter.fileId, ext: ext)
            guard let bytes = FileStore.size(url: url) else { continue }
            guard bytes == chapter.sizeBytes else {
                FileStore.delete(url: url)
                continue
            }
            // Only hash when the manifest carries one to compare against.
            // Digesting every already-downloaded chapter on each launch would
            // read the whole book off disk to answer a question nothing asked.
            let digest = chapter.sha256 == nil ? nil : Self.sha256Hex(of: url)
            plan.apply(.completed(fileId: chapter.fileId, status: 200, bytes: bytes, sha256: digest))
        }
        emitState()
    }

    private func loadExistingTasks() {
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            self.stateQueue.async {
                for task in tasks {
                    guard let fileId = self.fileId(from: task.taskDescription) else { continue }
                    self.activeFileIds.insert(fileId)
                    self.plan.apply(.started(fileId: fileId))
                }
                self.hasLoadedExistingTasks = true
                self.emitState()
                self.pumpIfNeeded()
            }
        }
    }

    private func pumpIfNeeded() {
        guard isRunning, hasLoadedExistingTasks else { return }

        let availableSlots = max(0, maxConcurrentDownloads - activeFileIds.count)
        guard availableSlots > 0 else { return }

        let candidates = plan.nextToStart(limit: maxConcurrentDownloads)
        var started = 0

        for fileId in candidates {
            guard started < availableSlots else { break }
            guard !activeFileIds.contains(fileId) else { continue }
            guard let chapter = chapterByFileId[fileId],
                  let url = resolvedChapterURL(for: chapter)
            else {
                plan.apply(.transportFailed(fileId: fileId))
                emitState()
                continue
            }

            var request = URLRequest(url: url)
            request.httpMethod = "GET"

            let task = session.downloadTask(with: request)
            task.taskDescription = "\(editionId)/\(fileId)"
            activeFileIds.insert(fileId)
            plan.apply(.started(fileId: fileId))
            task.resume()
            started += 1
        }

        if started > 0 {
            emitState()
        }
    }

    func urlSession(_: URLSession,
                    downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL)
    {
        guard let fileId = fileId(from: downloadTask.taskDescription) else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? -1

        if !(200 ... 299).contains(status) {
            // Captured locally: os.Logger's privacy-annotated interpolation wraps
            // each value in an escaping autoclosure, which would otherwise need
            // an explicit self.editionId that SwiftFormat's redundantSelf rule
            // (correctly, outside this one case) wants to strip back out.
            let editionId = editionId
            Log.download.error(
                """
                Chapter download failed: \
                editionId=\(editionId, privacy: .public) \
                fileId=\(fileId, privacy: .public) \
                status=\(status, privacy: .public)
                """
            )
            applyEventAndContinue(
                .completed(fileId: fileId, status: status, bytes: 0, sha256: nil),
                fileId: fileId
            )
            return
        }

        guard let chapter = chapterByFileId[fileId] else {
            applyEventAndContinue(.transportFailed(fileId: fileId), fileId: fileId)
            return
        }

        let ext = fileExtension(for: chapter)
        var destination = FileStore.chapterURL(editionId: editionId, fileId: fileId, ext: ext)
        let fileManager = FileManager.default

        // Best-effort: a failure here is uninteresting on its own. The move
        // below either overwrites what's left, or fails and is already
        // reported through the existing transportFailed path.
        if fileManager.fileExists(atPath: destination.path) {
            try? fileManager.removeItem(at: destination)
        }

        do {
            try fileManager.moveItem(at: location, to: destination)
        } catch {
            applyEventAndContinue(.transportFailed(fileId: fileId), fileId: fileId)
            return
        }

        FileStore.excludeFromBackup(&destination)
        let bytes = FileStore.size(url: destination) ?? 0
        applyEventAndContinue(
            .completed(
                fileId: fileId,
                status: status,
                bytes: bytes,
                sha256: Self.sha256Hex(of: destination)
            ),
            fileId: fileId
        )
    }

    /// SHA-256 of a downloaded chapter, lowercase hex to match the digest format
    /// the server uses elsewhere (`createHash("sha256").digest("hex")`).
    ///
    /// Read in chunks rather than with `Data(contentsOf:)`: a chapter is tens of
    /// megabytes and this runs on the URLSession delegate queue, so loading a
    /// whole file into memory per completed download is not acceptable.
    ///
    /// Returns nil when the file cannot be read. `DownloadPlan` only compares the
    /// hash when the manifest carries one, so nil keeps today's byte-count-only
    /// behavior rather than failing a download over an unreadable digest.
    private static func sha256Hex(of url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }

        var hasher = SHA256()
        let chunkSize = 1024 * 1024
        while true {
            guard let chunk = try? handle.read(upToCount: chunkSize), !chunk.isEmpty else {
                break
            }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        guard let fileId = fileId(from: task.taskDescription) else { return }
        applyEventAndContinue(.transportFailed(fileId: fileId), fileId: fileId)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession _: URLSession) {
        stateQueue.async {
            let completion = self.backgroundSessionCompletion
            self.backgroundSessionCompletion = nil
            DispatchQueue.main.async {
                completion?()
            }
        }
    }

    private func applyEventAndContinue(_ event: DownloadEvent, fileId: Int) {
        stateQueue.async {
            self.activeFileIds.remove(fileId)
            self.plan.apply(event)
            self.emitState()
            self.pumpIfNeeded()
        }
    }

    private func emitState() {
        let snapshot = plan
        DispatchQueue.main.async { [onState] in
            onState(snapshot)
        }
    }

    private func fileId(from taskDescription: String?) -> Int? {
        guard let taskDescription else { return nil }
        let parts = taskDescription.split(separator: "/", maxSplits: 1).map(String.init)
        guard parts.count == 2,
              let parsedEditionId = Int(parts[0]),
              parsedEditionId == editionId,
              let fileId = Int(parts[1])
        else {
            return nil
        }
        return fileId
    }

    private func fileExtension(for chapter: ManifestChapter) -> String {
        guard let url = resolvedChapterURL(for: chapter) ?? URL(string: chapter.url) else {
            return "bin"
        }
        let ext = url.pathExtension
        return ext.isEmpty ? "bin" : ext
    }

    private func resolvedChapterURL(for chapter: ManifestChapter) -> URL? {
        if let resolved = URL(string: chapter.url, relativeTo: baseURL)?.absoluteURL {
            return resolved
        }
        if let absolute = URL(string: chapter.url), absolute.scheme != nil {
            return absolute
        }
        return nil
    }
}
