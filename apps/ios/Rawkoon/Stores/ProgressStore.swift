import Foundation
import Observation
import RawkoonKit

/// Owns listening and reading progress: the position journal, the throttled
/// playback writes and their server push, the resume previews, ebook files and
/// the audiobook/ebook handoff. Session, library, downloads and toasts come from
/// the stores passed to `init`; the player is a service it reads and drives; the
/// network path and the player-opening flow are hooks `AppModel.init` wires, so
/// the store holds no back-reference to the model.
@MainActor
@Observable
final class ProgressStore {
    /// Last known resume point per audiobook edition, so a button can read
    /// "Resume from …" before the player is opened. Filled by
    /// `loadResumePreview(editionId:totalDurationSecs:)`.
    var resumePreview: [Int: Double] = [:]
    /// The ebook equivalent: the stored reading position per edition, so a button
    /// can name the chapter before the reader is opened.
    var readingResumePreview: [Int: ReadingPosition] = [:]
    var activeEditionId: Int?
    var lastProgressWriteMillis: [Int: Int64] = [:]
    var lastProgressPosition: [Int: Double] = [:]
    let readingProgressStore = ReadingProgressStore(
        directory: FileStore.booksDirectory()
    )
    /// Automatic handoff matches already answered or running, so reopening a book
    /// without moving does not transcribe again. In memory: a launch may recheck.
    var handoffMemo = HandoffSuggestion.Memo()
    /// Per book, when its audiobook and ebook positions last agreed through a handoff.
    var handoffAgreedAtMillis: [Int: Int64] = [:]

    let journalURL: URL

    // MARK: Hooks wired by AppModel.init

    /// Whether the device currently has a usable network path.
    var isOnline: () -> Bool = { true }
    /// Loads an edition into the player (at a position); stays with the model because it spans downloads too.
    var openPlayer: (_ editionId: Int, _ resumeAt: Double?) async -> Void = { _, _ in }

    let session: SessionStore
    let libraryStore: LibraryStore
    let downloads: DownloadsStore
    let router: UIRouter
    let player: AudiobookPlayer

    init(
        session: SessionStore,
        libraryStore: LibraryStore,
        downloads: DownloadsStore,
        router: UIRouter,
        player: AudiobookPlayer
    ) {
        self.session = session
        self.libraryStore = libraryStore
        self.downloads = downloads
        self.router = router
        self.player = player
        journalURL = Self.positionLogURL()
    }

    static func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    // MARK: Playback progress

    func persistPlaybackProgress(force: Bool) {
        guard let editionId = activeEditionId, let manifest = downloads.manifests[editionId] else {
            return
        }

        let nowMillis = Self.nowMillis()
        if !force {
            let elapsed = nowMillis - (lastProgressWriteMillis[editionId] ?? 0)
            if elapsed < 5000 {
                return
            }
            if let last = lastProgressPosition[editionId], abs(last - player.positionSecs) < 1 {
                return
            }
        }

        let timeline = BookTimeline(chapters: manifest.chapters)
        let clamped = timeline.clamp(player.positionSecs)
        let entry = PositionEntry(editionId: editionId, positionSecs: clamped, atMillis: nowMillis)
        appendJournal(entry)

        lastProgressWriteMillis[editionId] = nowMillis
        lastProgressPosition[editionId] = clamped

        sendProgress(
            editionId: editionId,
            positionSecs: clamped,
            totalDurationSecs: manifest.totalDurationSecs,
            updatedAtMillis: nowMillis
        )
    }

    func sendProgress(
        editionId: Int,
        positionSecs: Double,
        totalDurationSecs: Double,
        updatedAtMillis: Int64
    ) {
        guard let apiClient = session.apiClient else { return }
        let finished = isListeningFinished(positionSecs: positionSecs, totalDurationSecs: totalDurationSecs)
        let updatedAt = Date(timeIntervalSince1970: Double(updatedAtMillis) / 1000)

        Task {
            try? await apiClient.putProgress(
                editionId: editionId,
                positionSecs: positionSecs,
                totalDurationSecs: totalDurationSecs,
                finished: finished,
                updatedAt: updatedAt,
                deviceId: session.deviceID
            )
        }
    }

    /// Drops an edition's local progress (journal lines, reading position) after a
    /// read mark or reset, closing the player if it holds one of them.
    func clearLocalProgress(editionIds: [Int]) {
        for editionId in editionIds {
            try? readingProgressStore.remove(editionId: editionId)
            lastProgressPosition[editionId] = nil
        }
        let kept = PositionJournal.excluding(
            readJournal(), editionIds: Set(editionIds), serverKey: ActiveServerKey.shared.value
        )
        try? kept.write(to: journalURL, atomically: true, encoding: .utf8)
        // Closed, not rewound: a playing book would PUT a position within seconds
        // and recreate the progress row the server just deleted. activeEditionId
        // goes first so the unload's pause has nothing to save.
        if let active = activeEditionId, editionIds.contains(active) {
            activeEditionId = nil
            player.unload()
        }
    }

    // MARK: Position journal

    private static func positionLogURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var url = root.appendingPathComponent("positions.log", isDirectory: false)
        FileStore.excludeFromBackup(&url)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        return url
    }

    /// Rewrites the journal to one line per edition. Run once at launch, before
    /// anything appends, since every open reads and parses the whole file.
    func compactJournal() {
        let text = readJournal()
        guard !text.isEmpty else { return }
        let compacted = PositionJournal.compacted(text)
        guard compacted.utf8.count < text.utf8.count else { return }
        try? compacted.write(to: journalURL, atomically: true, encoding: .utf8)
    }

    /// Newest journal entry per edition, parsed off the main actor: the file is
    /// read on every book open, CarPlay refresh and resume lookup.
    func journalEntries() async -> [Int: PositionEntry] {
        let url = journalURL
        let serverKey = ActiveServerKey.shared.value
        return await Task.detached(priority: .userInitiated) {
            PositionJournal.latestByEdition((try? String(contentsOf: url, encoding: .utf8)) ?? "", serverKey: serverKey)
        }.value
    }

    func readJournal() -> String {
        (try? String(contentsOf: journalURL, encoding: .utf8)) ?? ""
    }

    /// Stamps every unstamped (legacy) journal line with the server key.
    func adoptLegacyJournal(serverKey key: String) {
        let journal = readJournal()
        let adopted = PositionJournal.adopting(journal, serverKey: key)
        if adopted != journal {
            try? adopted.write(to: journalURL, atomically: true, encoding: .utf8)
        }
    }

    func appendJournal(_ unstamped: PositionEntry) {
        let entry = unstamped.with(serverKey: ActiveServerKey.shared.value)
        if !FileManager.default.fileExists(atPath: journalURL.path) {
            FileManager.default.createFile(atPath: journalURL.path, contents: nil)
        }

        guard let handle = try? FileHandle(forUpdating: journalURL) else {
            return
        }

        do {
            let end = try handle.seekToEnd()
            var partial = false
            if end > 0 {
                try handle.seek(toOffset: end - 1)
                partial = try handle.read(upToCount: 1)?.first != UInt8(ascii: "\n")
            }
            let line = PositionJournal.appendText(for: entry, afterPartialLine: partial)
            guard let data = line.data(using: .utf8), !data.isEmpty else {
                try handle.close()
                return
            }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.close()
        } catch {
            try? handle.close()
        }
    }
}
