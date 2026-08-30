import Foundation
import RawkoonKit

final class ChapterDownloader: NSObject, URLSessionDownloadDelegate {
    private let editionId: Int
    private let manifest: BookManifest
    private let onState: (DownloadPlan) -> Void
    private let stateQueue = DispatchQueue(label: "cloud.samlo.rawkoon.chapter-downloader")
    private let chapterByFileId: [Int: ManifestChapter]
    private let maxConcurrentDownloads = 3

    private var plan: DownloadPlan
    private var isRunning = false
    private var hasLoadedExistingTasks = false
    private var activeFileIds: Set<Int> = []

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(
            withIdentifier: "cloud.samlo.rawkoon.dl.\(editionId)"
        )
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    init(editionId: Int, manifest: BookManifest, onState: @escaping (DownloadPlan) -> Void) {
        self.editionId = editionId
        self.manifest = manifest
        self.onState = onState
        self.plan = DownloadPlan(chapters: manifest.chapters)
        self.chapterByFileId = Dictionary(uniqueKeysWithValues: manifest.chapters.map { ($0.fileId, $0) })
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

    private func reconcileExistingFiles() {
        for chapter in manifest.chapters {
            let ext = fileExtension(for: chapter)
            guard FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: ext) else { continue }
            let url = FileStore.chapterURL(editionId: editionId, fileId: chapter.fileId, ext: ext)
            guard let bytes = FileStore.size(url: url) else { continue }
            plan.apply(.completed(fileId: chapter.fileId, status: 200, bytes: bytes, sha256: nil))
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
                  let url = URL(string: chapter.url) else {
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

    func urlSession(_ session: URLSession,
                    downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        guard let fileId = fileId(from: downloadTask.taskDescription) else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? -1

        if !(200...299).contains(status) {
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
            .completed(fileId: fileId, status: status, bytes: bytes, sha256: nil),
            fileId: fileId
        )
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        guard let fileId = fileId(from: task.taskDescription) else { return }
        applyEventAndContinue(.transportFailed(fileId: fileId), fileId: fileId)
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
              let fileId = Int(parts[1]) else {
            return nil
        }
        return fileId
    }

    private func fileExtension(for chapter: ManifestChapter) -> String {
        guard let url = URL(string: chapter.url) else { return "bin" }
        let ext = url.pathExtension
        return ext.isEmpty ? "bin" : ext
    }
}
