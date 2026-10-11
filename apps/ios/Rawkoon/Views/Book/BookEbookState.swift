import Observation
import RawkoonKit

/// Kept by BookView so downloads and file loading survive a lane switch.
@MainActor @Observable final class BookEbookState {
    var ebookFiles: [BookEditionFile] = []
    var loadingEbookFiles = false
    var rescanningEbook = false
    var openingEbookFileId: Int?
    var downloadingEbookFileIDs = Set<Int>()
    /// Cancel taps need the live tasks, including when another lane is visible.
    var ebookDownloadTasks: [Int: Task<Void, Never>] = [:]
    var ebookFilesError: String?
}

extension BookView {
    var ebookFiles: [BookEditionFile] {
        get { ebookState.ebookFiles }
        nonmutating set { ebookState.ebookFiles = newValue }
    }

    var loadingEbookFiles: Bool {
        get { ebookState.loadingEbookFiles }
        nonmutating set { ebookState.loadingEbookFiles = newValue }
    }

    var rescanningEbook: Bool {
        get { ebookState.rescanningEbook }
        nonmutating set { ebookState.rescanningEbook = newValue }
    }

    var openingEbookFileId: Int? {
        get { ebookState.openingEbookFileId }
        nonmutating set { ebookState.openingEbookFileId = newValue }
    }

    var downloadingEbookFileIDs: Set<Int> {
        get { ebookState.downloadingEbookFileIDs }
        nonmutating set { ebookState.downloadingEbookFileIDs = newValue }
    }

    var ebookDownloadTasks: [Int: Task<Void, Never>] {
        get { ebookState.ebookDownloadTasks }
        nonmutating set { ebookState.ebookDownloadTasks = newValue }
    }

    var ebookFilesError: String? {
        get { ebookState.ebookFilesError }
        nonmutating set { ebookState.ebookFilesError = newValue }
    }
}
