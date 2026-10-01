import Foundation

/// Append-only trace of one book's download events, kept so a stall can be read
/// back off the device. Capped so it never grows past a few hundred KB.
final nonisolated class DownloadJournal: @unchecked Sendable {
    private let url: URL
    /// One queue for every instance: two handles appending at once clobber each other's lines.
    private static let queue = DispatchQueue(label: "cloud.samlo.rawkoon.download-journal")
    private static let maxBytes = 400_000
    private static let stamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter
    }()

    init(editionId: Int) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        url = docs.appendingPathComponent("download-journal-\(editionId).log")
    }

    func log(_ line: @autoclosure () -> String) {
        let text = "\(Self.stamp.string(from: Date())) \(line())\n"
        Self.queue.async {
            guard let data = text.data(using: .utf8) else { return }
            if let handle = try? FileHandle(forWritingTo: self.url) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: data)
                if let size = try? handle.offset(), size > UInt64(Self.maxBytes) {
                    self.trim()
                }
            } else {
                try? data.write(to: self.url)
            }
        }
    }

    private func trim() {
        guard let data = try? Data(contentsOf: url) else { return }
        try? data.suffix(Self.maxBytes / 2).write(to: url)
    }
}

/// Logs when the main thread fails to answer a ping for a while, so a UI that
/// "never updated" can be told apart from one that was blocked.
final nonisolated class MainThreadWatchdog: @unchecked Sendable {
    private let journal: DownloadJournal
    private let queue = DispatchQueue(label: "cloud.samlo.rawkoon.main-watchdog", qos: .utility)
    private var timer: DispatchSourceTimer?

    init(editionId: Int) {
        journal = DownloadJournal(editionId: editionId)
    }

    func start() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
        timer.setEventHandler { [journal] in
            let sent = Date()
            DispatchQueue.main.async {
                let lag = Date().timeIntervalSince(sent)
                if lag > 0.7 {
                    journal.log("MAIN THREAD STALL \(Int(lag * 1000)) ms")
                }
            }
        }
        timer.resume()
        self.timer = timer
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }
}
