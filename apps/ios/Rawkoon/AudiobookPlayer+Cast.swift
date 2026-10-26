import Foundation
import RawkoonKit

/// Where playback goes while a Cast receiver has the book. The player keeps
/// owning position, progress, the sleep timer and Now Playing; a route only
/// moves the receiver.
protocol AudiobookCastRoute: AnyObject {
    func load(at wholeBookPosition: Double, autoplay: Bool)
    func play()
    func pause()
    func seek(toWholeBook position: Double, autoplay: Bool)
    func setRate(_ rate: Float)
    /// Ends the receiver session; the player has already let go of the route.
    func stop()
}

extension AudiobookPlayer {
    var isCasting: Bool {
        castRoute != nil
    }

    /// Hands the book to a receiver. Local audio stops first so the two never overlap.
    /// `loadBook` is false when the receiver is already playing this book (a resumed session).
    func beginCasting(_ route: any AudiobookCastRoute, loadBook: Bool) {
        player?.pause()
        tearDownObservers()
        player?.removeAllItems()
        player = nil
        queuedItem = nil
        handledFailedItem = nil
        isSeeking = false
        streamRetryPending = false
        // Abandons any local seek completion or stream retry still in flight.
        seekID += 1
        playbackError = nil
        castRoute = route
        if loadBook {
            route.load(at: positionSecs, autoplay: true)
        }
    }

    /// The receiver's report, applied like a local tick so saved progress, the
    /// sleep timer and Now Playing carry on unchanged.
    func applyCastStatus(wholeBookPosition: Double, playing: Bool) {
        guard castRoute != nil, let timeline else { return }
        positionSecs = timeline.clamp(wholeBookPosition)
        if playing != isPlaying {
            setPlaying(playing)
        }
        advanceSleep()
        setCurrentChapter(index: timeline.chapterIndex(at: positionSecs))
        updateNowPlayingInfo()
    }

    /// Takes the book back from the receiver, paused where it stopped.
    func endCasting() {
        guard castRoute != nil else { return }
        castRoute = nil
        setPlaying(false)
        guard manifest != nil else { return }
        buildQueue(at: positionSecs, autoplay: false)
        updateNowPlayingInfo()
    }
}
