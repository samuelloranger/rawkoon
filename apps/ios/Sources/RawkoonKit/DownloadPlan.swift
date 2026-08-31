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

    public let chapters: [ManifestChapter]
    public private(set) var states: [Int: ChapterState]
    public private(set) var needsFreshGrants = false

    private var attempts: [Int: Int] = [:]
    private let chapterByFileId: [Int: ManifestChapter]

    public init(chapters: [ManifestChapter]) {
        self.chapters = chapters
        self.states = Dictionary(uniqueKeysWithValues: chapters.map { ($0.fileId, .pending) })
        self.chapterByFileId = Dictionary(uniqueKeysWithValues: chapters.map { ($0.fileId, $0) })
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
            guard chapterByFileId[fileId] != nil else { return }
            states[fileId] = .pending
            attempts[fileId] = 0

        case let .started(fileId):
            guard chapterByFileId[fileId] != nil else { return }
            states[fileId] = .inFlight

        case let .completed(fileId, status, bytes, sha256):
            guard let chapter = chapterByFileId[fileId] else { return }
            if status == 401 || status == 403 {
                // Not the chapter's fault: the grant expired. Requeue without
                // spending an attempt, and tell the caller to refetch.
                states[fileId] = .pending
                needsFreshGrants = true
                return
            }
            guard (200...299).contains(status) else { return fail(fileId) }
            guard bytes == chapter.sizeBytes else { return fail(fileId) }
            if let expected = chapter.sha256, expected != sha256 {
                return fail(fileId)
            }
            states[fileId] = .verified

        case let .transportFailed(fileId):
            fail(fileId)

        case let .evicted(fileId):
            guard chapterByFileId[fileId] != nil else { return }
            states[fileId] = .evicted
        }
    }

    private mutating func fail(_ fileId: Int) {
        guard chapterByFileId[fileId] != nil else { return }
        let n = min((attempts[fileId] ?? 0) + 1, Self.maxAttempts)
        attempts[fileId] = n
        states[fileId] = .failed(attempts: n)
    }

    /// The next chapters worth starting, in book order.
    ///
    /// Book order matters: a listener starts at chapter 1, so downloading in
    /// order means they can begin before the book finishes arriving.
    public func nextToStart(limit: Int) -> [Int] {
        guard limit > 0 else { return [] }
        var out: [Int] = []
        for chapter in chapters.sorted(by: { $0.index < $1.index }) {
            guard out.count < limit else { break }
            switch states[chapter.fileId] {
            case .pending:
                out.append(chapter.fileId)
            case let .failed(attempts) where attempts < Self.maxAttempts:
                out.append(chapter.fileId)
            default:
                continue
            }
        }
        return out
    }

    public var isComplete: Bool {
        !chapters.isEmpty && chapters.allSatisfy { states[$0.fileId] == .verified }
    }

    public func progressFraction() -> Double {
        guard !chapters.isEmpty else { return 0 }
        let done = chapters.filter { states[$0.fileId] == .verified }.count
        return Double(done) / Double(chapters.count)
    }
}
