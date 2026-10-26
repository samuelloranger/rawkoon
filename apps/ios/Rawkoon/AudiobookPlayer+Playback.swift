import AVFoundation
import Foundation
import MediaPlayer
import RawkoonKit
import UIKit

/// Playback lifecycle, controls, and seek coordination.
extension AudiobookPlayer {
    func load(manifest: BookManifest, baseURL: URL, resumeAt: Double, artworkURL: URL? = nil) {
        // A different book is a new session. Carrying the old one's pause clock
        // over would rewind this book by how long the last one sat paused, and
        // carrying the interruption flag would auto-start it when a prompt that
        // began during the previous book ends.
        pausedAt = nil
        wasPlayingBeforeInterruption = false
        playbackError = nil
        recoveredFileIds = []
        streamRetriedAt = [:]
        // An end-of-chapter timer names a chapter of the old book; a rebuild of
        // the same book keeps it.
        if self.manifest?.editionId != manifest.editionId {
            setSleep(.off)
        }
        self.manifest = manifest
        self.baseURL = baseURL
        loadArtwork(from: artworkURL)
        chapters = manifest.chapters.sorted { $0.index < $1.index }
        filesById = Dictionary(uniqueKeysWithValues: manifest.files.map { ($0.id, $0) })
        let timeline = BookTimeline(chapters: chapters)
        self.timeline = timeline
        setDuration(chapters.last?.endSecs ?? manifest.totalDurationSecs)
        let clamped = timeline.clamp(resumeAt)
        buildQueue(at: clamped, autoplay: false)
        updateNowPlayingInfo()
    }

    func rebuild() {
        // The receiver streams regardless of what is on the phone.
        guard castRoute == nil, let manifest, let baseURL else { return }
        let resumeAt = positionSecs
        let resumePlaying = isPlaying
        load(manifest: manifest, baseURL: baseURL, resumeAt: resumeAt, artworkURL: artworkURL)
        if resumePlaying {
            play()
        }
    }

    /// Stops playback and forgets the book, so the mini player can be closed.
    ///
    /// The Now Playing entry has to go with it: leaving it behind keeps a
    /// paused book on the Lock Screen and in CarPlay with no way to dismiss it.
    func unload() {
        if let castRoute {
            self.castRoute = nil
            castRoute.stop()
        }
        pause()
        artworkTask?.cancel()
        artworkTask = nil
        tearDownObservers()
        player?.removeAllItems()
        player = nil
        manifest = nil
        timeline = nil
        chapters = []
        filesById = [:]
        itemFiles = [:]
        queuedItem = nil
        handledFailedItem = nil
        streamRetriedAt = [:]
        streamRetryPending = false
        // Abandons a pending stream retry.
        seekID += 1
        artwork = nil
        artworkURL = nil
        positionSecs = 0
        setDuration(0)
        setCurrentChapter(nil)
        setSleep(.off)
        pausedAt = nil
        wasPlayingBeforeInterruption = false
        playbackError = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        // Now that no player item is left, the session can actually be released
        // — and other apps are told they may resume.
        do {
            try AVAudioSession.sharedInstance().setActive(
                false,
                options: .notifyOthersOnDeactivation
            )
        } catch {
            Log.playback.error(
                """
                Failed to deactivate audio session: \
                error=\(error.localizedDescription, privacy: .public)
                """
            )
        }
    }

    func play() {
        playbackError = nil
        // The listener resumed by hand, so no pending interruption resume is owed.
        wasPlayingBeforeInterruption = false
        setPlaying(true)
        if case .minutes = sleepMode {
            lastSleepTick = Date()
        }
        if let castRoute {
            castRoute.play()
            updateNowPlayingInfo()
            return
        }
        if player?.currentItem == nil, duration > 0 {
            // A queue drained by a stopped failure: Play is a fresh attempt, so
            // the stream gets its URL-refresh retry again.
            streamRetriedAt = [:]
            seek(to: playStartPosition(positionSecs: positionSecs, durationSecs: duration), userInitiated: false)
            return
        }
        // The pending retry starts playback itself once it rebuilds.
        if streamRetryPending {
            updateNowPlayingInfo()
            return
        }
        // A failed item never plays; a tap after the error is a fresh attempt,
        // fresh URLs included.
        if player?.currentItem?.status == .failed {
            streamRetriedAt = [:]
            buildQueue(at: positionSecs, autoplay: true)
            return
        }
        // play() cancels an in-flight seek, which is the race that makes
        // scrubbing look like a no-op. Resume from the completion handler.
        if isSeeking {
            // The seek's completion resumes playback without coming back
            // through here, so the rewind has to be spent now or it would sit
            // unspent and fire on some later play() while already playing.
            pausedAt = nil
            updateNowPlayingInfo()
            return
        }
        // `isPlaying` is already true, so the seek autoplays and its completion
        // calls beginPlayback for us — one seek, no audio at the stale position.
        if let target = consumeSmartRewindTarget() {
            seek(to: target, userInitiated: false)
            return
        }
        beginPlayback()
    }

    /// Pauses at the listener's request.
    ///
    /// Distinct from the interruption path: choosing to pause during a
    /// navigation prompt means the book should stay paused when the prompt
    /// ends, however the system feels about `.shouldResume`.
    func pause() {
        wasPlayingBeforeInterruption = userPaused(
            InterruptionState(isPlaying: isPlaying, resumePending: wasPlayingBeforeInterruption)
        ).resumePending
        castRoute?.pause()
        stopPlayback()
    }

    /// Stops the audio without deactivating the audio session.
    ///
    /// A paused book is still the Now Playing session: deactivating would tell
    /// every other app to resume, and `setActive(false)` is expected to fail
    /// anyway while an `AVPlayer` still holds a current item. The session is
    /// released in `unload()`, once the queue is gone.
    func stopPlayback() {
        // Only a real playing-to-paused transition starts the rewind clock. A
        // second pause on an already-paused book would otherwise throw away the
        // overnight gap that makes the rewind worth having.
        if isPlaying {
            pausedAt = Date()
        }
        player?.pause()
        setPlaying(false)
        updateNowPlayingInfo()
    }

    func beginPlayback() {
        guard let player else {
            // Same lie as a failed activation: `play()` has already published
            // isPlaying, and there is no player to make good on it.
            setPlaying(false)
            updateNowPlayingInfo()
            return
        }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Better to show a paused book than to claim playback that is not
            // happening — silence with a pause button is the bug this whole
            // change exists to remove.
            setPlaying(false)
            updateNowPlayingInfo()
            return
        }
        // `defaultRate` rather than assigning `rate` after `play()`: the latter
        // is reset to 1.0 whenever the queue advances to a new chapter item, so
        // a book playing at 1.25× would silently drop back to normal speed.
        player.defaultRate = rate
        player.play()
        updateNowPlayingInfo()
    }

    /// Where playback should resume, once the gap since the pause is accounted
    /// for — or nil to resume exactly where it stopped.
    ///
    /// Consumes `pausedAt`, so the rewind can only ever be spent once.
    /// Deliberately NOT applied from inside `beginPlayback()`: a seek there
    /// starts audio at the old position and only then jumps back, and the seek
    /// completion re-enters `beginPlayback`. The offset has to be folded into
    /// the seek that starts playback instead.
    func consumeSmartRewindTarget() -> Double? {
        guard let pausedAt else { return nil }
        self.pausedAt = nil
        guard UserDefaults.standard.bool(forKey: "smart_rewind") else { return nil }
        let offset = smartRewindOffset(pausedFor: Date().timeIntervalSince(pausedAt))
        guard offset > 0 else { return nil }
        return positionSecs - offset
    }

    /// Seek the current item. `play()` must not run until this finishes —
    /// AVPlayer treats play() as cancelling an in-flight seek, which leaves
    /// playback at the pre-seek time.
    func seekCurrentItem(to offset: Double, autoplay: Bool) {
        guard let player else { return }
        itemStatusObserver = nil
        seekID += 1
        let id = seekID
        isSeeking = true
        setPlaying(autoplay)
        let time = CMTime(seconds: max(0, offset), preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.seekID == id else { return }
                    self.isSeeking = false
                    guard finished else {
                        // Cancelled, not superseded — a newer seek would have
                        // been caught by the seekID guard above. `positionSecs`
                        // was written optimistically in `seek(to:)`, so take
                        // the truth back from the player rather than reporting
                        // a position it never reached.
                        if let current = self.player?.currentTime().seconds, current.isFinite {
                            self.positionSecs = self.wholeBookPosition(fromCurrentItemTime: current)
                        }
                        self.updateNowPlayingInfo()
                        return
                    }
                    if self.isPlaying {
                        self.beginPlayback()
                    } else {
                        self.updateNowPlayingInfo()
                    }
                }
            }
        }
    }

    /// In-place seek that waits for the item: AVFoundation raises on a seek with
    /// a completion handler before the item is ready to play.
    func seekCurrentItemWhenReady(to offset: Double, autoplay: Bool) {
        // Supersedes a status observer still waiting from an earlier seek.
        seekID += 1
        seekWhenReady(offset: offset, autoplay: autoplay)
    }

    func seekWhenReady(offset: Double, autoplay: Bool) {
        guard let item = player?.currentItem else {
            isSeeking = false
            return
        }
        let id = seekID
        switch item.status {
        case .readyToPlay:
            seekCurrentItem(to: offset, autoplay: autoplay)
        case .failed:
            isSeeking = false
            handleFailedItem(item)
        default:
            isSeeking = true
            setPlaying(autoplay)
            itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
                let status = item.status
                let failedItem: AVPlayerItem? = status == .failed ? item : nil
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        guard let self, self.seekID == id else { return }
                        switch status {
                        case .readyToPlay:
                            self.itemStatusObserver = nil
                            self.seekCurrentItem(to: offset, autoplay: self.isPlaying)
                        case .failed:
                            self.itemStatusObserver = nil
                            self.isSeeking = false
                            self.handleFailedItem(failedItem ?? item)
                        default:
                            break
                        }
                    }
                }
            }
        }
    }
}
