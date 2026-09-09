import Foundation

public enum ChapterState: Equatable, Sendable {
    case pending
    case inFlight
    case verified
    case failed(attempts: Int)
    case evicted
}

public enum DownloadEvent: Equatable, Sendable {
    case requested(fileId: Int)
    case started(fileId: Int)
    /// A background task reports completion for any response the server sent,
    /// including an error body. `status` is what separates audio from a 401 page.
    case completed(fileId: Int, status: Int, bytes: Int, sha256: String?)
    case transportFailed(fileId: Int)
    case evicted(fileId: Int)
}

/// What a book's download is doing. It decides; it never transfers.
public struct DownloadPlan: Sendable {
    public static let maxAttempts = 3

    public let files: [ManifestFile]
    public private(set) var states: [Int: ChapterState]
    public private(set) var needsFreshGrants = false

    private var attempts: [Int: Int] = [:]
    private let fileById: [Int: ManifestFile]

    public init(files: [ManifestFile]) {
        self.files = files
        states = Dictionary(uniqueKeysWithValues: files.map { ($0.id, .pending) })
        fileById = Dictionary(uniqueKeysWithValues: files.map { ($0.id, $0) })
    }

    /// Cleared once the caller has swapped in freshly signed URLs. Without
    /// this the flag latches and every later state emission looks like a new
    /// request for grants.
    public mutating func acknowledgeFreshGrants() {
        needsFreshGrants = false
    }

    public mutating func apply(_ event: DownloadEvent) {
        switch event {
        case let .requested(fileId):
            guard fileById[fileId] != nil else { return }
            states[fileId] = .pending
            attempts[fileId] = 0

        case let .started(fileId):
            guard fileById[fileId] != nil else { return }
            states[fileId] = .inFlight

        case let .completed(fileId, status, bytes, sha256):
            guard let file = fileById[fileId] else { return }
            if status == 401 || status == 403 {
                // Not the file's fault: the grant expired. Requeue without
                // spending an attempt, and tell the caller to refetch.
                states[fileId] = .pending
                needsFreshGrants = true
                return
            }
            guard (200 ... 299).contains(status) else { return fail(fileId) }
            guard bytes == file.sizeBytes else { return fail(fileId) }
            if let expected = file.sha256, expected != sha256 {
                return fail(fileId)
            }
            states[fileId] = .verified

        case let .transportFailed(fileId):
            fail(fileId)

        case let .evicted(fileId):
            guard fileById[fileId] != nil else { return }
            states[fileId] = .evicted
        }
    }

    private mutating func fail(_ fileId: Int) {
        guard fileById[fileId] != nil else { return }
        let n = min((attempts[fileId] ?? 0) + 1, Self.maxAttempts)
        attempts[fileId] = n
        states[fileId] = .failed(attempts: n)
    }

    /// Re-queues every chapter that gave up, so a network blip that latched
    /// `.failed(maxAttempts)` no longer strands the book below 100% forever.
    public mutating func retryFailed() {
        for fileId in states.keys where isFailed(states[fileId]) {
            states[fileId] = .pending
            attempts[fileId] = 0
        }
    }

    private func isFailed(_ state: ChapterState?) -> Bool {
        if case .failed = state {
            return true
        }
        return false
    }

    /// The next files worth starting, in book order.
    ///
    /// Book order matters: a listener starts at the front, so downloading in
    /// order means they can begin before the book finishes arriving.
    public func nextToStart(limit: Int) -> [Int] {
        guard limit > 0 else { return [] }
        var out: [Int] = []
        for file in files.sorted(by: { $0.startSecs < $1.startSecs }) {
            guard out.count < limit else { break }
            switch states[file.id] {
            case .pending:
                out.append(file.id)
            case let .failed(attempts) where attempts < Self.maxAttempts:
                out.append(file.id)
            default:
                continue
            }
        }
        return out
    }

    public var isComplete: Bool {
        !files.isEmpty && files.allSatisfy { states[$0.id] == .verified }
    }

    public func progressFraction() -> Double {
        guard !files.isEmpty else { return 0 }
        let done = files.filter { states[$0.id] == .verified }.count
        return Double(done) / Double(files.count)
    }

    /// Rebuilds a plan from files already on disk after a process kill.
    ///
    /// Size is the only check: hashing hundreds of megabytes on launch would
    /// freeze the book screen. A wrong-size file stays pending so the next
    /// download can replace it, rather than consuming a retry attempt.
    public static func restored(
        files: [ManifestFile],
        existingBytes: [Int: Int]
    ) -> DownloadPlan {
        var plan = DownloadPlan(files: files)
        for file in files {
            guard let bytes = existingBytes[file.id], bytes == file.sizeBytes else {
                continue
            }
            plan.apply(
                .completed(
                    fileId: file.id,
                    status: 200,
                    bytes: bytes,
                    sha256: file.sha256
                )
            )
        }
        return plan
    }
}
