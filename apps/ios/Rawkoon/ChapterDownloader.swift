import Foundation
import Network
import RawkoonKit
import UIKit

/// The I/O half of a book download. `DownloadEngine` (RawkoonKit, tested on
/// Linux) decides what runs and how far along the book is; this class owns the
/// URLSessions and the disk, turns delegate callbacks into engine events, and
/// executes the engine's commands. All engine access is serialized on `stateQueue`.
final class ChapterDownloader: NSObject, URLSessionDownloadDelegate {
    let editionId: Int
    private let baseURL: URL
    private let onSnapshot: (DownloadSnapshot) -> Void
    let stateQueue = DispatchQueue(label: "cloud.samlo.rawkoon.chapter-downloader")
    private let sessionIdentifier: String
    /// Fired once the cancelled session has fully invalidated; a new session with
    /// the same identifier created before that collides with it.
    var onInvalidated: (@Sendable () -> Void)?

    /// Not `let`: an expired grant is replaced in place rather than by tearing
    /// the background session down, because the session identifier has to stay
    /// stable for `handleEventsForBackgroundURLSession` to map back to it.
    private var manifest: BookManifest
    var fileById: [Int: ManifestFile]
    var engine: DownloadEngine
    var isCancelled = false
    var tasks: [Int: URLSessionDownloadTask] = [:]
    var backgroundSessionCompletion: (() -> Void)?

    private var lastEmittedStructure = -1
    private var lastEmittedRevision = -1
    private var lastEmit = Date.distantPast
    private var trailingEmitScheduled = false
    private var idleReconcilePending = false
    private static let idleReconcileDelay: TimeInterval = 5
    private static let progressEmitInterval: TimeInterval = 0.1

    let pathMonitor = NWPathMonitor()
    let journal: DownloadJournal
    private let watchdog: MainThreadWatchdog
    /// Keeps foreground transfers alive for iOS's short background grace period.
    var graceTaskId = UIBackgroundTaskIdentifier.invalid
    var lifecycleObservers: [NSObjectProtocol] = []

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
            let planned = Dictionary(uniqueKeysWithValues: self.engine.plan.files.map { ($0.id, $0) })
            // A rescan can keep ids but re-encode the bytes; the signed `url` always differs.
            let changedIds = Set(manifest.files.filter { fresh in
                planned[fresh.id].map { !$0.sameContent(as: fresh) } ?? false
            }.map(\.id))
            let idsChanged = freshIds != Set(planned.keys) || !changedIds.isEmpty
            self.manifest = manifest
            self.fileById = Dictionary(uniqueKeysWithValues: manifest.files.map { ($0.id, $0) })
            if idsChanged {
                // Re-imported on the server mid-download: the old ids will never
                // verify, so start over from what is already on disk.
                self.send(.replaceFiles(manifest.files))
                // Same-id files with new content go too: an equal size alone can't prove the old bytes are current.
                FileStore.deleteChapters(editionId: self.editionId, keeping: freshIds.subtracting(changedIds))
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

    func send(_ event: EngineEvent) {
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

    // MARK: Helpers

    /// The Settings "download over" choice, read when each chapter starts.
    private static func allowsCellular() -> Bool {
        UserDefaults.standard.string(forKey: "download_over") != "wifi"
    }

    func fileId(from taskDescription: String?) -> Int? {
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
