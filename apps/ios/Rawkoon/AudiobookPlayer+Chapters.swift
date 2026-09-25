import AVFoundation
import Foundation
import RawkoonKit

/// Seek, skip, chapter navigation, and playback-rate control. Split out of
/// AudiobookPlayer.swift; behavior unchanged. Stored properties stay in the
/// main class body.
extension AudiobookPlayer {
    func clearPlaybackError() {
        playbackError = nil
    }

    /// `userInitiated` is false for the player's own moves (smart rewind,
    /// auto-advance, rebuilds), which must not retarget an end-of-chapter timer.
    func seek(to seconds: Double, userInitiated: Bool = true) {
        guard let timeline else { return }
        // Any deliberate move — a scrub, a chapter jump, a skip — replaces
        // "resume where you stopped", so there is nothing left to rewind to.
        // Without this, pausing, jumping to a chapter and pressing play would
        // rewind off the front of the chapter the listener just chose.
        pausedAt = nil
        playbackError = nil
        let clamped = timeline.clamp(seconds)
        let autoplay = isPlaying
        positionSecs = clamped
        // "End of chapter" means the chapter being listened to, so a jump re-arms it.
        if userInitiated, sleepMode == .endOfChapter {
            sleepEndChapterIndex = timeline.chapterIndex(at: clamped)
        }
        updateNowPlayingInfo()

        // In-place when the target stays inside the currently-loaded physical
        // file, even across a chapter boundary (single-file audiobook): reloading
        // the whole file to move between its own chapters would stutter.
        if let currentFile = file(for: player?.currentItem),
           let offset = currentFile.inPlaceSeekOffset(to: clamped, bookDurationSecs: duration),
           player?.currentItem != nil
        {
            seekCurrentItemWhenReady(to: offset, autoplay: autoplay)
            return
        }
        buildQueue(at: clamped, autoplay: autoplay)
    }

    func skipForward(_ seconds: Double = 30) {
        seek(to: positionSecs + seconds)
    }

    func skipBackward(_ seconds: Double = 30) {
        seek(to: positionSecs - seconds)
    }

    func jumpToChapter(_ chapter: ManifestChapter) {
        seek(to: chapter.startSecs)
    }

    /// The manifest's chapters, exposed read-only so CarPlay can build a chapter
    /// picker. Empty until a book is loaded.
    var chapterList: [ManifestChapter] {
        chapters
    }

    /// The rates the quick-cycle speed button steps through, in order. A tap
    /// advances to the next one and wraps past the end back to the first — this
    /// is the CarPlay rate button's ladder, distinct from the phone UI's picker.
    static let rateLadder: [Float] = [1.0, 1.25, 1.5, 1.75, 2.0]

    /// Advances to the next rate in `rateLadder`. Snaps to the nearest ladder
    /// entry first, so a rate set from the phone (e.g. 0.8×) still cycles sanely.
    func cycleRate() {
        let ladder = Self.rateLadder
        let nearest = ladder.min(by: { abs($0 - rate) < abs($1 - rate) }) ?? ladder[0]
        let index = ladder.firstIndex(of: nearest) ?? 0
        setRate(ladder[(index + 1) % ladder.count])
    }

    func setRate(_ value: Float) {
        rate = value
        applyPitchAlgorithm()
        // Both: `defaultRate` so the next chapter item starts at this speed,
        // `rate` so the change is audible immediately rather than at the next
        // chapter boundary.
        player?.defaultRate = value
        if isPlaying {
            player?.rate = value
        }
        updateNowPlayingInfo()
    }

    func nextChapter() {
        guard let timeline, let next = timeline.boundary(after: positionSecs) else { return }
        seek(to: next)
    }

    func prevChapter() {
        guard let timeline else { return }
        if let previous = timeline.boundary(before: positionSecs) {
            seek(to: previous)
        } else {
            seek(to: 0)
        }
    }
}
