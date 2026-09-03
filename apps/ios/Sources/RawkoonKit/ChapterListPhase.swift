import Foundation

/// What the book screen's chapter list should show.
///
/// A missing manifest is not itself a failure: the fetch may not have started
/// yet (it used to wait on the ebook files request). Only a finished fetch
/// with no chapters is an error.
public enum ChapterListPhase: Equatable, Sendable {
    case loading
    case ready
    case failed(String)
}

public func chapterListPhase(
    loading: Bool,
    fetchAttempted: Bool,
    hasChapters: Bool,
    error: String?
) -> ChapterListPhase {
    if hasChapters {
        return .ready
    }
    if loading || !fetchAttempted {
        return .loading
    }
    return .failed(error ?? "Chapters couldn't load.")
}
