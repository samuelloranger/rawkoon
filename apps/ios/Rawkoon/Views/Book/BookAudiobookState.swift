import Observation

/// Kept by BookView so an in-flight play or download, and its error, survive a lane switch.
@MainActor @Observable final class BookAudiobookState {
    var preparingAudiobookDownload = false
    var loadingPlayer = false
    var audiobookActionError: String?
    var showDownloadFinished = false
}
