import CryptoKit
import Foundation
import Network
import RawkoonKit
import UIKit

/// The I/O half of a book download. `DownloadEngine` (RawkoonKit, tested on
/// Linux) decides what runs and how far along the book is; this class owns the
/// URLSessions and the disk, turns delegate callbacks into engine events, and
/// executes the engine's commands. All engine access is serialized on `stateQueue`.
final class ChapterDownloader: NSObject, URLSessionDownloadDelegate {
    private let editionId: Int
    private let baseURL: URL
    private let onSnapshot: (DownloadSnapshot) -> Void
    private let stateQueue = DispatchQueue(label: "cloud.samlo.rawkoon.chapter-downloader")
    private let sessionIdentifier: String
    /// Fired once the cancelled session has fully invalidated; a new session with
    /// the same identifier created before that collides with it.
    private var onInvalidated: (@Sendable () -> Void)?

    /// Not `let`: an expired grant is replaced in place rather than by tearing
    /// the background session down, because the session identifier has to stay
    /// stable for `handleEventsForBackgroundURLSession` to map back to it.
    private var manifest: BookManifest
    private var fileById: [Int: ManifestFile]
    private var engine: DownloadEngine
    private var isCancelled = false
    private var tasks: [Int: URLSessionDownloadTask] = [:]
    private var backgroundSessionCompletion: (() -> Void)?

    private var lastEmittedStructure = -1
    private var lastEmittedRevision = -1
    private var lastEmit = Date.distantPast
    private var trailingEmitScheduled = false
    private var idleReconcilePending = false
    private static let idleReconcileDelay: TimeInterval = 5
    private static let progressEmitInterval: TimeInterval = 0.1

    private let pathMonitor = NWPathMonitor()
    private let journal: DownloadJournal
    private let watchdog: MainThreadWatchdog
    /// Keeps foreground transfers alive for iOS's short background grace period.
    private var graceTaskId = UIBackgroundTaskIdentifier.invalid
    private var lifecycleObservers: [NSObjectProtocol] = []

    /// iOS throttles background sessions even with the app on screen, so chapters
    /// start on this default session while the app is up and on `session` otherwise.
    private var foregroundSessionStorage: URLSession?
    private var foregroundSession: URLSession {
        if let existing = foregroundSessionStorage {
            return existing
        }
        let config = URLSessionConfiguration.default
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        config.httpMaximumConnectionsPerHost = DownloadEngine.wifiConcurrency
        config.timeoutIntervalForResource = 60 * 60 * 24
        let created = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        foregroundSessionStorage = created
        return created
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: sessionIdentifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        // Cellular is decided per request, so the setting applies to the next
        // chapter instead of waiting for a new session.
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    init(
        editionId: Int,
        baseURL: URL,
        manifest: BookManifest,
        onState: @escaping (DownloadSnapshot) -> Void
    ) {
        self.editionId = editionId
        self.baseURL = baseURL
        self.manifest = manifest
        onSnapshot = onState
        sessionIdentifier = Self.sessionIdentifier(editionId: editionId)
        journal = DownloadJournal(editionId: editionId)
        watchdog = MainThreadWatchdog(editionId: editionId)
        fileById = Dictionary(uniqueKeysWithValues: manifest.files.map { ($0.id, $0) })
        let foreground = Thread.isMainThread ? UIApplication.shared.applicationState != .background : false
        engine = DownloadEngine(files: manifest.files, isForeground: foreground)
        super.init()
        journal.log("init edition=\(editionId) files=\(manifest.files.count) foreground=\(foreground)")
        observeEnvironment()
        watchdog.start()
        stateQueue.async { self.bootstrap() }
    }

    // MARK: Public API

    func start() {
        stateQueue.async { self.send(.start) }
    }

    /// Cancels every transfer and tears both sessions down. Single-use: `AppModel`
    /// drops the downloader and deletes any partial files afterward. The resulting
    /// `NSURLErrorCancelled` is swallowed in `didCompleteWithError`.
    func cancel(onInvalidated: (@Sendable () -> Void)? = nil) {
        // Serialized on stateQueue so it lands after any in-flight command batch
        // rather than racing a task being created on the session being invalidated.
        stateQueue.sync {
            self.onInvalidated = onInvalidated
            _ = self.engine.handle(.cancel)
            self.isCancelled = true
            self.pathMonitor.cancel()
            self.lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
            self.lifecycleObservers = []
            self.tasks.removeAll()
            self.endBackgroundGrace()
            self.watchdog.stop()
            self.journal.log("cancelled")
            self.foregroundSessionStorage?.invalidateAndCancel()
            self.session.invalidateAndCancel()
        }
    }

    /// Re-queues chapters that gave up, so a download stranded by a blip finishes
    /// once the network is back. Called on reconnect and on a re-tap.
    func retryFailedChapters() {
        stateQueue.async { self.send(.retryFailed) }
    }

    /// Re-derives chapter state from the live tasks and the disk, the way a
    /// relaunch does, so a lost completion cannot hold the book short of 100%.
    func resync() {
        stateQueue.async { self.resyncOnQueue() }
    }

    /// Swaps in freshly signed chapter URLs and lets the queue run again.
    ///
    /// A grant lasts seven days; a download paused past that, or a server whose
    /// secret rotated, gets 401/403 forever otherwise, because the plan requeues
    /// those without spending an attempt.
    func refreshChapterURLs(from manifest: BookManifest) {
        stateQueue.async {
            guard !self.isCancelled else { return }
            let freshIds = Set(manifest.files.map(\.id))
            let idsChanged = freshIds != Set(self.engine.plan.files.map(\.id))
            self.manifest = manifest
            self.fileById = Dictionary(uniqueKeysWithValues: manifest.files.map { ($0.id, $0) })
            if idsChanged {
                // Re-imported on the server mid-download: the old ids will never
                // verify, so start over from what is already on disk.
                self.send(.replaceFiles(manifest.files))
                FileStore.deleteChapters(editionId: self.editionId, keeping: freshIds)
                self.reconcileWithDisk()
            }
            self.send(.grantsRefreshed)
        }
    }

    /// See `DownloadPlan.abandonAwaitingGrants`.
    func grantRefreshFailed() {
        stateQueue.async { self.send(.grantsRefreshFailed) }
    }

    func setBackgroundSessionCompletion(_ completion: @escaping () -> Void) {
        stateQueue.async { self.backgroundSessionCompletion = completion }
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

    // MARK: Engine plumbing (stateQueue)

    private func observeEnvironment() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let wifi = path.usesInterfaceType(.wifi) && !path.isExpensive && !path.isConstrained
            self?.stateQueue.async { self?.send(.unmeteredWifi(wifi)) }
        }
        pathMonitor.start(queue: stateQueue)
        let center = NotificationCenter.default
        lifecycleObservers = [
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
                self?.beginBackgroundGrace()
            },
            center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in
                self?.stateQueue.async {
                    self?.endBackgroundGrace()
                    self?.send(.appForeground(true))
                }
            },
        ]
    }

    /// A brief app switch should not demote six fast transfers to the throttled
    /// background session: keep them running until iOS says time is up.
    private func beginBackgroundGrace() {
        let id = UIApplication.shared.beginBackgroundTask(withName: "chapter-downloads") { [weak self] in
            self?.stateQueue.async {
                self?.journal.log("grace expired")
                self?.send(.appForeground(false))
                self?.endBackgroundGrace()
            }
        }
        stateQueue.async {
            self.journal.log("entered background, grace task started")
            self.endBackgroundGrace()
            self.graceTaskId = id
            if self.engine.plan.isComplete {
                self.endBackgroundGrace()
            }
        }
    }

    private func endBackgroundGrace() {
        guard graceTaskId != .invalid else { return }
        UIApplication.shared.endBackgroundTask(graceTaskId)
        graceTaskId = .invalid
    }

    /// Disk first, then whatever the background session still holds from a previous launch.
    private func bootstrap() {
        reconcileWithDisk()
        session.getAllTasks { [weak self] listed in
            guard let self else { return }
            stateQueue.async {
                var ids: Set<Int> = []
                for task in listed where task.state == .running || task.state == .suspended {
                    guard let fileId = self.fileId(from: task.taskDescription),
                          let download = task as? URLSessionDownloadTask else { continue }
                    self.tasks[fileId] = download
                    ids.insert(fileId)
                }
                self.send(.existingBackgroundTasks(fileIds: ids))
            }
        }
    }

    private func send(_ event: EngineEvent) {
        guard !isCancelled else { return }
        let commands = engine.handle(event)
        logEvent(event, commands: commands)
        execute(commands)
        flush()
        if engine.plan.isComplete {
            endBackgroundGrace()
            watchdog.stop()
        }
        scheduleIdleReconcileIfWanted()
    }

    private func logEvent(_ event: EngineEvent, commands: [EngineCommand]) {
        if case let .progress(fileId, _, written, expected) = event {
            // Only the end of a transfer matters for a stall; the rest is noise.
            guard expected > 0, written >= expected else { return }
            journal.log("progress-complete file=\(fileId)")
            return
        }
        let verified = engine.plan.states.values.filter { $0 == .verified }.count
        journal.log("event \(event) -> \(commands.count) cmds verified=\(verified)/\(engine.plan.files.count) active=\(engine.activeFileIds.sorted())")
    }

    private func execute(_ commands: [EngineCommand]) {
        for command in commands {
            switch command {
            case let .startTask(fileId, lane):
                startTask(fileId: fileId, lane: lane)
            case let .cancelTask(fileId, _):
                tasks.removeValue(forKey: fileId)?.cancel()
            case let .deleteFile(fileId):
                // A size-only reconcile would otherwise accept the bad file next launch.
                if let file = fileById[fileId] {
                    FileStore.delete(url: FileStore.chapterURL(editionId: editionId, fileId: fileId, ext: file.fileExtension))
                }
            }
        }
    }

    private func startTask(fileId: Int, lane: TransferLane) {
        guard let file = fileById[fileId], let url = resolvedChapterURL(for: file) else {
            send(.finished(fileId: fileId, lane: lane, outcome: .transportFailed))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let cellular = Self.allowsCellular()
        request.allowsCellularAccess = cellular
        request.allowsExpensiveNetworkAccess = cellular
        request.allowsConstrainedNetworkAccess = cellular
        let task = (lane == .foreground ? foregroundSession : session).downloadTask(with: request)
        task.taskDescription = "\(editionId)/\(fileId)"
        tasks[fileId] = task
        task.resume()
    }

    /// One snapshot channel for plan and progress. Structural changes go out at
    /// once; byte progress is throttled, with a trailing emit so the last tick lands.
    private func flush() {
        let structural = engine.structureRevision != lastEmittedStructure
        guard structural || engine.revision != lastEmittedRevision else { return }
        let now = Date()
        if !structural, now.timeIntervalSince(lastEmit) < Self.progressEmitInterval {
            guard !trailingEmitScheduled else { return }
            trailingEmitScheduled = true
            stateQueue.asyncAfter(deadline: .now() + Self.progressEmitInterval) {
                self.trailingEmitScheduled = false
                self.flush()
            }
            return
        }
        lastEmittedStructure = engine.structureRevision
        lastEmittedRevision = engine.revision
        lastEmit = now
        let snapshot = engine.snapshot
        if structural {
            journal.log("emit rev=\(snapshot.revision) verified=\(snapshot.plan.states.values.filter { $0 == .verified }.count) complete=\(snapshot.plan.isComplete)")
        }
        // Main-queue dispatch is FIFO; the receiver applies it synchronously.
        DispatchQueue.main.async { [onSnapshot] in onSnapshot(snapshot) }
    }

    private func scheduleIdleReconcileIfWanted() {
        guard !idleReconcilePending, engine.consumeIdleReconcile() else { return }
        idleReconcilePending = true
        stateQueue.asyncAfter(deadline: .now() + Self.idleReconcileDelay) {
            self.idleReconcilePending = false
            self.resyncOnQueue()
        }
    }

    private func resyncOnQueue() {
        guard !isCancelled else { return }
        session.getAllTasks { [weak self] listed in
            guard let self else { return }
            stateQueue.async {
                var live = Set(self.tasks.compactMap { id, task in
                    task.state == .running || task.state == .suspended ? id : nil
                })
                for task in listed where task.state == .running || task.state == .suspended {
                    if let id = self.fileId(from: task.taskDescription) {
                        live.insert(id)
                    }
                }
                self.reconcileWithDisk(liveFileIds: live)
            }
        }
    }

    /// A leftover file of the wrong size is discarded, not failed, so it never
    /// spends a retry attempt. Size only: the file was hashed when it arrived.
    private func reconcileWithDisk(liveFileIds: Set<Int>? = nil) {
        var onDisk: [Int: Int] = [:]
        for file in engine.plan.files {
            let url = FileStore.chapterURL(editionId: editionId, fileId: file.id, ext: file.fileExtension)
            guard FileStore.exists(editionId: editionId, fileId: file.id, ext: file.fileExtension),
                  let bytes = FileStore.size(url: url) else { continue }
            if bytes == file.sizeBytes {
                onDisk[file.id] = bytes
            } else if !(liveFileIds?.contains(file.id) ?? false) {
                FileStore.delete(url: url)
            }
        }
        send(.reconcile(onDiskBytes: onDisk, liveFileIds: liveFileIds ?? []))
    }

    // MARK: URLSession delegate

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
    private static func sha256Hex(of url: URL) -> String? {
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

    // MARK: Helpers

    /// The Settings "download over" choice, read when each chapter starts.
    private static func allowsCellular() -> Bool {
        UserDefaults.standard.string(forKey: "download_over") != "wifi"
    }

    private func fileId(from taskDescription: String?) -> Int? {
        guard let taskDescription else { return nil }
        let parts = taskDescription.split(separator: "/", maxSplits: 1).map(String.init)
        guard parts.count == 2, Int(parts[0]) == editionId, let fileId = Int(parts[1]) else { return nil }
        return fileId
    }

    private func resolvedChapterURL(for file: ManifestFile) -> URL? {
        if let resolved = URL(string: file.url, relativeTo: baseURL)?.absoluteURL {
            return resolved
        }
        if let absolute = URL(string: file.url), absolute.scheme != nil {
            return absolute
        }
        return nil
    }
}
