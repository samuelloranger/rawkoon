import AVFoundation
import Foundation
import MediaPlayer
import Observation
import RawkoonKit
import UIKit

@Observable
final class AudiobookPlayer {
    private(set) var positionSecs: Double = 0 {
        didSet { onPositionTick?() }
    }

    private(set) var isPlaying = false {
        didSet {
            // Combine sink was .dropFirst().removeDuplicates(), fired on !isPlaying:
            // i.e. only on an actual playing→paused transition.
            if oldValue, !isPlaying {
                onPlaybackStopped?()
            }
        }
    }

    private(set) var currentChapterIndex: Int?
    private(set) var currentChapter: ManifestChapter?
    private(set) var rate: Float = 1.0
    private(set) var duration: Double = 0
    /// Set when the next chapter cannot play. Cleared on a new load, seek, or
    /// the listener dismissing the alert. Never used to skip ahead.
    private(set) var playbackError: String?

    /// Called on every positionSecs change — AppModel uses it to persist progress
    /// (throttled inside persistPlaybackProgress). Replaces the Combine relay's
    /// player.$positionSecs sink.
    var onPositionTick: (() -> Void)?
    /// Called when playback transitions from playing to paused. Replaces the
    /// player.$isPlaying.dropFirst().removeDuplicates() sink that force-persisted.
    var onPlaybackStopped: (() -> Void)?

    /// Sleep timer. Countdown advances on playback ticks, so it naturally pauses
    /// when playback pauses. `.endOfChapter` stops when the current chapter ends.
    enum SleepMode: Equatable {
        case off
        case minutes(Int)
        case endOfChapter
    }

    private(set) var sleepMode: SleepMode = .off
    private(set) var sleepRemainingSecs: Double?

    private var sleepEndChapterIndex: Int?
    private var lastSleepTick: Date?
    private static let sleepFadeWindow: Double = 8

    /// When playback last stopped, for smart rewind. Nil while playing.
    private var pausedAt: Date?
    /// Whether an interruption arrived while we were playing, so `.ended` knows
    /// whether resuming is even appropriate.
    private var wasPlayingBeforeInterruption = false
    private var interruptionObserver: NSObjectProtocol?
    /// The remote-command targets this instance registered, so `deinit` can
    /// remove exactly those.
    private var commandTargets: [(command: MPRemoteCommand, target: Any)] = []
    private var resetObserver: NSObjectProtocol?

    private var artworkURL: URL?
    private var artwork: MPMediaItemArtwork?
    private var artworkTask: Task<Void, Never>?

    private var player: AVQueuePlayer?
    private var timeline: BookTimeline?
    private var manifest: BookManifest?
    private var baseURL: URL?
    private var chapters: [ManifestChapter] = []
    private var itemChapters: [ObjectIdentifier: ManifestChapter] = [:]
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var failedEndObserver: NSObjectProtocol?
    private var currentItemObserver: NSKeyValueObservation?
    private var itemStatusObserver: NSKeyValueObservation?
    /// Bumped on every seek so a stale completion cannot play() after a newer seek.
    private var seekID = 0
    /// While true, ticks and current-item KVO must not overwrite `positionSecs`.
    private var isSeeking = false
    /// Chapters whose unreadable local file was already discarded once this
    /// session, so a chapter that fails for another reason cannot loop.
    private var recoveredFileIds: Set<Int> = []

    init() {
        configureAudioSession()
        observeInterruptions()
        configureRemoteCommands()
    }

    deinit {
        // AudiobookPlayer is only ever held strongly by AppModel (@MainActor)
        // and SwiftUI views observing it, both main-actor-only owners — every
        // other reference to self in this file is `[weak self]` — so the last
        // release, and therefore this deinit, always runs on the main actor.
        MainActor.assumeIsolated {
            if let timeObserver, let player {
                player.removeTimeObserver(timeObserver)
            }
            if let endObserver {
                NotificationCenter.default.removeObserver(endObserver)
            }
            for observer in [interruptionObserver, resetObserver] {
                if let observer {
                    NotificationCenter.default.removeObserver(observer)
                }
            }
            // `MPRemoteCommandCenter` is process-global. Leaving handlers
            // behind would let a dead player answer the Lock Screen; removing
            // them by token rather than with `removeTarget(nil)` leaves any
            // other owner's alone.
            for entry in commandTargets {
                entry.command.removeTarget(entry.target)
            }
        }
    }

    // MARK: Audio session

    /// Category and mode are set once, not on every play.
    ///
    /// `.spokenAudio` is what makes another app's speech — a Maps navigation
    /// prompt — interrupt this book rather than duck it, which is right for an
    /// audiobook and is why interruption handling below matters so much.
    /// `.longFormAudio` is the documented routing policy for books and podcasts;
    /// it enables AirPlay 2 long-form routing, and it forbids explicit category
    /// options, so none are passed.
    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, policy: .longFormAudio)
            // Ask for a route disconnect to arrive as an interruption rather
            // than only a route change, so the one handler below owns every
            // reason playback stops. This is the default for a Now Playing
            // session since iOS 17; saying so makes it a request rather than
            // an assumption.
            //
            // A separate route-change observer is deliberately NOT used. It
            // would have to pause, and pausing clears the resume flag — so a
            // Bluetooth profile switch, which a car makes on every call and on
            // some navigation prompts, would report the old route as
            // unavailable and cancel the very resume this class exists for.
            try session.setPrefersInterruptionOnRouteDisconnect(true)
        } catch {
            // A session that will not configure still leaves the transport
            // controls usable; playback simply fails later, visibly.
        }
    }

    /// Resumes after a phone call, Siri, or a Maps navigation prompt.
    ///
    /// Without this the book stopped mid-drive and stayed stopped until the
    /// listener reached for the Lock Screen. `.shouldResume` is a hint from the
    /// system rather than a command, and Apple is explicit that media apps must
    /// wait for it instead of resuming on their own — a Siri "pause" arrives as
    /// an interruption too, and obeying it is the whole point.
    ///
    /// Route disconnects come through here too: the session asks for a
    /// disconnect to be delivered as an interruption, so pulling AirPods out or
    /// losing the car's Bluetooth lands here carrying no `.shouldResume`, and
    /// the book stays paused instead of playing on out of the phone's speaker.
    private func observeInterruptions() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        interruptionObserver = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: .main
        ) { [weak self] notification in
            // Parsed outside the isolated block: `Notification` itself isn't
            // Sendable (its `userInfo` is `[AnyHashable: Any]?`), but the
            // `InterruptionEvent` it boils down to is — only that crosses.
            guard let event = self?.parseInterruptionEvent(notification) else { return }
            MainActor.assumeIsolated {
                self?.handleInterruption(event)
            }
        }

        // Category and mode are set once now, rather than on every play, so
        // nothing re-establishes them if the media server restarts and hands
        // back a blank default session. Without this the next play would
        // activate the wrong session and go silent.
        resetObserver = center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: session,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.handleMediaServicesReset()
            }
        }
    }

    /// Rebuilds everything after the media server restarts.
    ///
    /// The old `AVPlayer` must be dropped without being spoken to — Apple's
    /// rule after a reset is to discard the objects, and the ordinary teardown
    /// path would call `removeTimeObserver` on a player that no longer exists.
    /// Nilling the handles first means the rebuild cannot reach it.
    ///
    /// A reset during an interruption keeps the pending resume: the flag would
    /// otherwise be cleared by `load()`, and the prompt's `.ended` would find
    /// nothing to resume.
    private func handleMediaServicesReset() {
        guard let manifest, let baseURL else { return }
        let resumeAt = positionSecs
        let wasPlaying = isPlaying
        let hadPendingResume = wasPlayingBeforeInterruption

        timeObserver = nil
        currentItemObserver = nil
        itemStatusObserver = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        if let failedEndObserver {
            NotificationCenter.default.removeObserver(failedEndObserver)
        }
        failedEndObserver = nil
        player = nil
        isPlaying = false

        configureAudioSession()
        load(manifest: manifest, baseURL: baseURL, resumeAt: resumeAt, artworkURL: artworkURL)

        if wasPlaying {
            play()
        } else {
            wasPlayingBeforeInterruption = hadPendingResume
        }
    }

    /// Pure parse of the notification's `userInfo` into the `Sendable` event
    /// `handleInterruption` acts on — kept `nonisolated` and free of `self`
    /// state so it can run before the notification closure hops to the main
    /// actor, since `Notification` itself is not `Sendable`.
    private nonisolated func parseInterruptionEvent(_ notification: Notification) -> InterruptionEvent? {
        guard
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return nil }

        // A `.began` raised because the app itself was suspended is not a real
        // interruption of playback, and pausing on it would stop a book that
        // nothing interrupted.
        if let rawReason = notification.userInfo?[AVAudioSessionInterruptionReasonKey] as? UInt,
           AVAudioSession.InterruptionReason(rawValue: rawReason) == .appWasSuspended
        {
            return nil
        }

        switch type {
        case .began:
            return .began
        case .ended:
            let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            return .ended(shouldResume: options.contains(.shouldResume))
        @unknown default:
            return nil
        }
    }

    private func handleInterruption(_ event: InterruptionEvent) {
        // The decision itself lives in RawkoonKit, where the cases that cannot
        // be reproduced on a simulator — a call during a navigation prompt, a
        // pause while the prompt is speaking — are unit tests instead.
        let (action, next) = interruptionDecision(
            event,
            state: InterruptionState(
                isPlaying: isPlaying,
                resumePending: wasPlayingBeforeInterruption
            )
        )
        wasPlayingBeforeInterruption = next.resumePending

        switch action {
        case .doNothing:
            break
        case .stopPlayback:
            stopPlayback()
        case .resumePlayback:
            resumeAfterInterruption()
        }
    }

    /// Resuming is continuing, or nothing.
    ///
    /// Deliberately not `play()`: its empty-queue branch seeks to 0, so an
    /// interruption landing exactly as the last chapter drains would restart
    /// the whole book.
    private func resumeAfterInterruption() {
        guard player?.currentItem != nil else { return }
        isPlaying = true
        if case .minutes = sleepMode {
            lastSleepTick = Date()
        }
        // The same guard `play()` carries, and for the same reason: AVPlayer
        // treats play() as cancelling an in-flight seek, so resuming here would
        // land back at the pre-seek position. `isPlaying` is set, so the seek's
        // own completion starts playback at the right place.
        if isSeeking {
            pausedAt = nil
            updateNowPlayingInfo()
            return
        }
        if let target = consumeSmartRewindTarget() {
            seek(to: target)
            return
        }
        beginPlayback()
    }

    func load(manifest: BookManifest, baseURL: URL, resumeAt: Double, artworkURL: URL? = nil) {
        // A different book is a new session. Carrying the old one's pause clock
        // over would rewind this book by how long the last one sat paused, and
        // carrying the interruption flag would auto-start it when a prompt that
        // began during the previous book ends.
        pausedAt = nil
        wasPlayingBeforeInterruption = false
        playbackError = nil
        recoveredFileIds = []
        self.manifest = manifest
        self.baseURL = baseURL
        loadArtwork(from: artworkURL)
        chapters = manifest.chapters.sorted { $0.index < $1.index }
        let timeline = BookTimeline(chapters: chapters)
        self.timeline = timeline
        duration = chapters.last?.endSecs ?? manifest.totalDurationSecs
        let clamped = timeline.clamp(resumeAt)
        buildQueue(at: clamped, autoplay: false)
        updateNowPlayingInfo()
    }

    func rebuild() {
        guard let manifest, let baseURL else { return }
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
        pause()
        artworkTask?.cancel()
        artworkTask = nil
        tearDownObservers()
        player?.removeAllItems()
        player = nil
        manifest = nil
        timeline = nil
        chapters = []
        itemChapters = [:]
        artwork = nil
        artworkURL = nil
        positionSecs = 0
        duration = 0
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
        isPlaying = true
        if case .minutes = sleepMode {
            lastSleepTick = Date()
        }
        if player?.currentItem == nil, duration > 0 {
            seek(to: 0)
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
            seek(to: target)
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
        stopPlayback()
    }

    /// Stops the audio without deactivating the audio session.
    ///
    /// A paused book is still the Now Playing session: deactivating would tell
    /// every other app to resume, and `setActive(false)` is expected to fail
    /// anyway while an `AVPlayer` still holds a current item. The session is
    /// released in `unload()`, once the queue is gone.
    private func stopPlayback() {
        // Only a real playing-to-paused transition starts the rewind clock. A
        // second pause on an already-paused book would otherwise throw away the
        // overnight gap that makes the rewind worth having.
        if isPlaying {
            pausedAt = Date()
        }
        player?.pause()
        isPlaying = false
        updateNowPlayingInfo()
    }

    func clearPlaybackError() {
        playbackError = nil
    }

    func seek(to seconds: Double) {
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
        updateNowPlayingInfo()

        if let offset = timeline.inPlaceSeekOffset(
            fromChapterIndex: currentChapterIndex,
            to: clamped
        ), player?.currentItem != nil {
            seekCurrentItem(to: offset, autoplay: autoplay)
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

    // MARK: Sleep timer

    func setSleep(_ mode: SleepMode) {
        sleepMode = mode
        sleepEndChapterIndex = nil
        lastSleepTick = nil
        resetSleepVolume()

        switch mode {
        case .off:
            sleepRemainingSecs = nil
        case let .minutes(m):
            sleepRemainingSecs = Double(m * 60)
            lastSleepTick = Date()
        case .endOfChapter:
            sleepRemainingSecs = nil
            sleepEndChapterIndex = currentChapterIndex
        }
    }

    /// Called from the playback tick. Advances the countdown by real elapsed
    /// time while playing, fades the last few seconds, then pauses.
    private func advanceSleep() {
        guard isPlaying else { lastSleepTick = Date(); return }

        switch sleepMode {
        case .off:
            return
        case .endOfChapter:
            if let target = sleepEndChapterIndex, let current = currentChapterIndex, current > target {
                fireSleep()
            }
        case .minutes:
            guard var remaining = sleepRemainingSecs else { return }
            let now = Date()
            let delta = min(2, max(0, now.timeIntervalSince(lastSleepTick ?? now)))
            lastSleepTick = now
            remaining -= delta
            sleepRemainingSecs = max(0, remaining)

            if remaining <= 0 {
                fireSleep()
            } else if remaining <= Self.sleepFadeWindow {
                player?.volume = Float(max(0, remaining / Self.sleepFadeWindow))
            }
        }
    }

    private func fireSleep() {
        pause()
        resetSleepVolume()
        sleepMode = .off
        sleepRemainingSecs = nil
        sleepEndChapterIndex = nil
        lastSleepTick = nil
    }

    private func resetSleepVolume() {
        player?.volume = 1
    }

    private func beginPlayback() {
        guard let player else {
            // Same lie as a failed activation: `play()` has already published
            // isPlaying, and there is no player to make good on it.
            isPlaying = false
            updateNowPlayingInfo()
            return
        }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Better to show a paused book than to claim playback that is not
            // happening — silence with a pause button is the bug this whole
            // change exists to remove.
            isPlaying = false
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
    private func consumeSmartRewindTarget() -> Double? {
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
    private func seekCurrentItem(to offset: Double, autoplay: Bool) {
        guard let player else { return }
        itemStatusObserver = nil
        seekID += 1
        let id = seekID
        isSeeking = true
        isPlaying = autoplay
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

    private func seekWhenReady(offset: Double, autoplay: Bool) {
        guard let item = player?.currentItem else {
            isSeeking = false
            return
        }
        let id = seekID
        switch item.status {
        case .readyToPlay:
            seekCurrentItem(to: offset, autoplay: autoplay)
        case .failed:
            logItemFailure(item)
            if recoverFromFailedLocalItem(item) {
                return
            }
            isSeeking = false
            reportUnplayable(chapter(for: item))
        default:
            isSeeking = true
            isPlaying = autoplay
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
                            if let failedItem {
                                self.logItemFailure(failedItem)
                            }
                            self.itemStatusObserver = nil
                            if let failedItem, self.recoverFromFailedLocalItem(failedItem) {
                                return
                            }
                            self.isSeeking = false
                            self.reportUnplayable(self.chapter(for: failedItem ?? item))
                        default:
                            break
                        }
                    }
                }
            }
        }
    }

    private func buildQueue(at wholeBookPosition: Double, autoplay: Bool) {
        guard let timeline, let manifest else { return }
        guard !chapters.isEmpty else {
            tearDownObservers()
            player = nil
            positionSecs = 0
            setCurrentChapter(index: nil)
            isPlaying = false
            isSeeking = false
            return
        }

        let clamped = timeline.clamp(wholeBookPosition)
        guard let chapter = chapter(forWholeBookPosition: clamped) else {
            tearDownObservers()
            player = nil
            positionSecs = clamped
            setCurrentChapter(index: nil)
            isPlaying = false
            isSeeking = false
            return
        }

        // Only the chapter being played. Enqueueing the rest of the book with
        // `.advance` is how an unplayable next chapter skipped to the last
        // one. The next chapter is started explicitly from `handleItemDidPlayToEnd`.
        let queueChapters = [chapter]
        var items: [AVPlayerItem] = []
        var mapping: [ObjectIdentifier: ManifestChapter] = [:]
        for queueChapter in queueChapters {
            guard let mediaURL = playbackURL(for: queueChapter, editionId: manifest.editionId) else {
                continue
            }
            let item = AVPlayerItem(url: mediaURL)
            item.audioTimePitchAlgorithm = .spectral
            items.append(item)
            mapping[ObjectIdentifier(item)] = queueChapter
        }

        guard !items.isEmpty else {
            tearDownObservers()
            player = nil
            positionSecs = clamped
            setCurrentChapter(index: nil)
            isPlaying = false
            isSeeking = false
            return
        }

        seekID += 1
        isSeeking = true
        tearDownObservers()
        let queuePlayer = AVQueuePlayer(items: items)
        // Never `.advance`: an unplayable next item used to walk the rest of
        // the playlist and land on the last chapter. We decide the next step
        // in `handleItemDidPlayToEnd`.
        queuePlayer.actionAtItemEnd = .pause
        player = queuePlayer
        itemChapters = mapping

        let offset = max(0, min(clamped - chapter.startSecs, max(chapter.durationSecs, 0)))
        positionSecs = clamped
        setCurrentChapter(chapter)
        isPlaying = autoplay
        installObservers(player: queuePlayer)
        applyPitchAlgorithm()
        seekWhenReady(offset: offset, autoplay: autoplay)
    }

    private func installObservers(player: AVQueuePlayer) {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated {
                self?.handleTick(time.seconds)
            }
        }

        // AVQueuePlayer.currentItem KVO is not documented to deliver on any
        // particular queue. Hop explicitly rather than assuming main, same as
        // itemStatusObserver.
        currentItemObserver = player.observe(\.currentItem, options: [.initial, .new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self?.handleCurrentItemChanged()
                }
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let item = notification.object as? AVPlayerItem else { return }
            let identifier = ObjectIdentifier(item)
            MainActor.assumeIsolated {
                self?.handleItemDidPlayToEnd(identifier)
            }
        }

        failedEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let item = notification.object as? AVPlayerItem else { return }
            let identifier = ObjectIdentifier(item)
            MainActor.assumeIsolated {
                self?.handleItemFailedToPlayToEnd(identifier)
            }
        }
    }

    private func tearDownObservers() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil

        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil

        if let failedEndObserver {
            NotificationCenter.default.removeObserver(failedEndObserver)
        }
        failedEndObserver = nil

        currentItemObserver = nil
        itemStatusObserver = nil
    }

    private func handleTick(_ rawSeconds: Double) {
        guard !isSeeking, rawSeconds.isFinite else { return }
        let clamped = timeline?.clamp(wholeBookPosition(fromCurrentItemTime: rawSeconds)) ?? max(rawSeconds, 0)
        positionSecs = clamped
        advanceSleep()
        if let chapter = chapter(for: player?.currentItem) {
            setCurrentChapter(chapter)
        } else {
            setCurrentChapter(index: timeline?.chapterIndex(at: clamped))
        }
        if isPlaying, player?.currentItem == nil {
            applyQueueDrained()
        }
        updateNowPlayingInfo()
    }

    private func handleCurrentItemChanged() {
        guard !isSeeking, let player else { return }
        if let chapter = chapter(for: player.currentItem) {
            setCurrentChapter(chapter)
            if let currentTime = player.currentItem?.currentTime().seconds, currentTime.isFinite {
                let clamped = timeline?.clamp(chapter.startSecs + max(currentTime, 0)) ?? max(currentTime, 0)
                positionSecs = clamped
            }
        } else if player.currentItem == nil {
            applyQueueDrained()
        }
        updateNowPlayingInfo()
    }

    /// A chapter file ended. The only legal next step is the immediate next
    /// chapter, or stop — never walking the rest of the playlist.
    private func handleItemDidPlayToEnd(_ identifier: ObjectIdentifier) {
        guard !isSeeking, let ended = itemChapters[identifier] else { return }
        setCurrentChapter(ended)
        positionSecs = ended.endSecs

        if sleepMode == .endOfChapter, sleepEndChapterIndex == ended.index {
            fireSleep()
            return
        }

        let next = chapters.first { $0.index > ended.index }
        let playable = next.map { nextChapterIsPlayable($0) } ?? true
        applyChapterAdvance(
            chapterAdvanceDecision(
                endedIndex: ended.index,
                chapters: chapters,
                nextIsPlayable: playable
            )
        )
    }

    private func handleItemFailedToPlayToEnd(_ identifier: ObjectIdentifier) {
        guard !isSeeking, let chapter = itemChapters[identifier] else { return }
        if let item = player?.currentItem, recoverFromFailedLocalItem(item) {
            return
        }
        reportUnplayable(chapter)
    }

    private func applyChapterAdvance(_ decision: ChapterAdvanceDecision) {
        switch decision {
        case .finishedBook:
            finishBook()
        case let .playNext(index):
            guard let next = chapter(forIndex: index) else {
                reportUnplayable(nil)
                return
            }
            isPlaying = true
            seek(to: next.startSecs)
        case let .stopWithError(index, title):
            stopWithUnplayableChapter(index: index, title: title)
        }
    }

    private func applyQueueDrained() {
        switch queueDrainedDecision(
            endedIndex: currentChapterIndex,
            lastIndex: chapters.last?.index
        ) {
        case .treatAsFinished:
            finishBook()
        case .stopWithError:
            let next = chapters.first { chapter in
                guard let current = currentChapterIndex else { return true }
                return chapter.index > current
            }
            stopWithUnplayableChapter(index: next?.index ?? currentChapterIndex ?? 0, title: next?.title ?? "")
        }
    }

    private func finishBook() {
        playbackError = nil
        stopPlayback()
        positionSecs = duration
        setCurrentChapter(index: chapters.last?.index)
        updateNowPlayingInfo()
    }

    private func nextChapterIsPlayable(_ chapter: ManifestChapter) -> Bool {
        guard let manifest else { return false }
        return playbackURL(for: chapter, editionId: manifest.editionId) != nil
    }

    private func stopWithUnplayableChapter(index: Int, title: String) {
        playbackError = unplayableChapterMessage(title: title)
        stopPlayback()
        Log.playback.error(
            """
            Stopped: next chapter is unplayable: \
            chapterIndex=\(index, privacy: .public) \
            title=\(title, privacy: .public)
            """
        )
        updateNowPlayingInfo()
    }

    private func reportUnplayable(_ chapter: ManifestChapter?) {
        stopWithUnplayableChapter(index: chapter?.index ?? -1, title: chapter?.title ?? "")
    }

    private func setCurrentChapter(_ chapter: ManifestChapter?) {
        currentChapter = chapter
        currentChapterIndex = chapter?.index
    }

    private func setCurrentChapter(index: Int?) {
        currentChapterIndex = index
        currentChapter = chapter(forIndex: index)
    }

    private func chapter(forIndex index: Int?) -> ManifestChapter? {
        guard let index else { return nil }
        return chapters.first(where: { $0.index == index })
    }

    /// A local chapter only wins when its size matches the manifest.
    ///
    /// An interrupted background download leaves a short file behind.
    /// `DownloadPlan` already refuses to verify one, but that verdict never
    /// reached here, so the player kept preferring a file AVPlayer cannot open
    /// — playback stayed dead until the app was deleted. Drop the bad file and
    /// stream instead.
    private func playbackURL(for chapter: ManifestChapter, editionId: Int) -> URL? {
        let ext = chapter.fileExtension
        if FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: ext) {
            let url = FileStore.chapterURL(editionId: editionId, fileId: chapter.fileId, ext: ext)
            if FileStore.size(url: url) == chapter.sizeBytes {
                return url
            }
            FileStore.delete(url: url)
        }
        return resolvedRemoteURL(for: chapter)
    }

    private func resolvedRemoteURL(for chapter: ManifestChapter) -> URL? {
        if let resolved = URL(string: chapter.url, relativeTo: baseURL)?.absoluteURL {
            return resolved
        }
        if let absolute = URL(string: chapter.url), absolute.scheme != nil {
            return absolute
        }
        return nil
    }

    /// A player item that fails is the end of the road for that chapter.
    /// We stop and surface an error rather than walking the playlist.
    private func logItemFailure(_ item: AVPlayerItem) {
        let chapterIndex = chapter(for: item)?.index ?? -1
        let fileId = chapter(for: item)?.fileId ?? -1
        let reason = item.error?.localizedDescription ?? "no error reported"
        Log.playback.error(
            """
            Chapter item failed to load: \
            chapterIndex=\(chapterIndex, privacy: .public) \
            fileId=\(fileId, privacy: .public) \
            error=\(reason, privacy: .public)
            """
        )
    }

    /// A downloaded chapter is trusted on file size alone (`playbackURL`), so a
    /// local file that is the right length but unreadable — a truncated or
    /// interrupted download — is preferred over the server copy and then fails to
    /// open. Delete it and rebuild so the same chapter streams instead. If that
    /// also fails, the caller reports an error; we never skip to a later chapter.
    ///
    /// Treat a failed LOCAL item as evidence the download is bad: delete it and
    /// rebuild the queue, which falls back to streaming. `recoveredFileIds` keeps
    /// this to one attempt per chapter per session, so a chapter that fails for
    /// some other reason cannot spin.
    ///
    /// Returns true when recovery was started, meaning the caller should not also
    /// treat the failure as final.
    private func recoverFromFailedLocalItem(_ item: AVPlayerItem) -> Bool {
        guard
            let chapter = chapter(for: item),
            let url = (item.asset as? AVURLAsset)?.url,
            url.isFileURL,
            !recoveredFileIds.contains(chapter.fileId)
        else {
            return false
        }

        recoveredFileIds.insert(chapter.fileId)
        Log.playback.error(
            """
            Deleting unreadable local chapter and falling back to streaming: \
            chapterIndex=\(chapter.index, privacy: .public) \
            fileId=\(chapter.fileId, privacy: .public)
            """
        )
        FileStore.delete(url: url)
        buildQueue(at: positionSecs, autoplay: isPlaying)
        return true
    }

    private func chapter(for item: AVPlayerItem?) -> ManifestChapter? {
        guard let item else { return nil }
        return itemChapters[ObjectIdentifier(item)]
    }

    private func chapter(forWholeBookPosition position: Double) -> ManifestChapter? {
        if let chapterIndex = timeline?.chapterIndex(at: position) {
            return chapters.first(where: { $0.index == chapterIndex })
        }
        if position >= duration {
            return chapters.last
        }
        return chapters.first
    }

    private func wholeBookPosition(fromCurrentItemTime currentItemTime: Double) -> Double {
        guard
            let chapter = chapter(for: player?.currentItem),
            currentItemTime.isFinite
        else {
            return currentItemTime
        }
        return chapter.startSecs + max(currentItemTime, 0)
    }

    private func applyPitchAlgorithm() {
        player?.currentItem?.audioTimePitchAlgorithm = .spectral
        for item in player?.items() ?? [] {
            item.audioTimePitchAlgorithm = .spectral
        }
    }

    private func updateNowPlayingInfo() {
        guard let manifest else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = currentChapter?.title ?? manifest.title
        info[MPMediaItemPropertyAlbumTitle] = manifest.title
        info[MPMediaItemPropertyArtist] = manifest.authors.joined(separator: ", ")
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionSecs
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0
        // Tells the system this book's normal speed is the listener's chosen
        // rate, not 1.0, so a rate control on the Lock Screen or in a car reads
        // against the right baseline.
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = rate
        if !chapters.isEmpty {
            info[MPNowPlayingInfoPropertyChapterCount] = chapters.count
            // Chapter numbering is zero-based and contiguous, which
            // `ManifestChapter.index` is only in practice — `BookTimeline`
            // treats it as a domain id and allows gaps. Send the ordinal.
            if let index = currentChapterIndex,
               let ordinal = chapters.firstIndex(where: { $0.index == index })
            {
                info[MPNowPlayingInfoPropertyChapterNumber] = ordinal
            }
        }
        if let artwork {
            info[MPMediaItemPropertyArtwork] = artwork
        } else {
            info.removeValue(forKey: MPMediaItemPropertyArtwork)
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// Fetches the cover for the Lock Screen, Control Center and CarPlay.
    ///
    /// `MPMediaItemArtwork` wants a `UIImage`, not a URL, so nothing shows
    /// until the bytes are in hand — which is why Now Playing was blank while
    /// the same cover rendered fine in-app through `AsyncImage`.
    private func loadArtwork(from url: URL?) {
        guard url != artworkURL || (url != nil && artwork == nil) else { return }
        artworkTask?.cancel()
        artworkTask = nil
        artworkURL = url
        artwork = nil
        guard let url else { return }

        artworkTask = Task { [weak self] in
            let data: Data
            do {
                (data, _) = try await URLSession.shared.data(from: url)
            } catch {
                Log.playback.error(
                    """
                    Artwork fetch failed: \
                    error=\(error.localizedDescription, privacy: .public)
                    """
                )
                return
            }
            guard
                !Task.isCancelled,
                let image = UIImage(data: data)
            else { return }
            await MainActor.run {
                guard let self, self.artworkURL == url else { return }
                self.artwork = Self.makeArtwork(image)
                self.updateNowPlayingInfo()
            }
        }
    }

    /// Builds the Now Playing artwork in a `nonisolated` context on purpose.
    ///
    /// `MPMediaItemArtwork`'s request handler is invoked by `MPNowPlayingInfoCenter`
    /// on MediaPlayer's own private queue, not the main actor. Created inside a
    /// `@MainActor` context, the closure inherits main-actor isolation, so under
    /// Swift 6 the runtime inserts an executor assertion that traps (EXC_BREAKPOINT)
    /// the moment MediaPlayer asks for the bitmap off-main — which crashed playback
    /// start as soon as Now Playing requested the cover. A `nonisolated` factory
    /// keeps the closure free of isolation; it only returns the captured `UIImage`
    /// (Sendable), so it is safe to call from any queue.
    private nonisolated static func makeArtwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }

    /// Wires the Lock Screen, Control Center, headset and car controls.
    ///
    /// `togglePlayPauseCommand` is not redundant next to play and pause: a wired
    /// headset button and many steering-wheel controls send only the toggle, so
    /// an app that wires the pair alone looks unresponsive in a car.
    ///
    /// Commands are enabled by default, so every one this player does not
    /// implement is disabled explicitly — otherwise a car head unit offers
    /// buttons that do nothing. Seek forward/backward stay off deliberately:
    /// they deliver begin/end seeking events for a press-and-hold, not the
    /// fixed jump that `skipForward`/`skipBackward` already provide.
    /// `MPRemoteCommandCenter` invokes handlers on its own queue, and every
    /// transport method here writes `@Published` state that SwiftUI and
    /// `AppModel`'s progress sink read on the main actor. Hop first.
    private func addTarget(
        _ command: MPRemoteCommand,
        _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus
    ) {
        commandTargets.append((command, command.addTarget(handler: handler)))
    }

    private func onMain(_ work: @escaping @MainActor () -> Void) -> MPRemoteCommandHandlerStatus {
        if Thread.isMainThread {
            MainActor.assumeIsolated {
                work()
            }
        } else {
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    work()
                }
            }
        }
        return .success
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        // Only ever this instance's own targets. `removeTarget(nil)` would
        // wipe the command center clean, and it is process-global — another
        // owner's handlers are not ours to unregister.
        for entry in commandTargets {
            entry.command.removeTarget(entry.target)
        }
        commandTargets.removeAll()

        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.skipForwardCommand.isEnabled = true
        center.skipBackwardCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackRateCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipBackwardCommand.preferredIntervals = [30]
        center.changePlaybackRateCommand.supportedPlaybackRates = [0.8, 1.0, 1.25, 1.5, 2.0]

        for unsupported in [
            center.seekForwardCommand,
            center.seekBackwardCommand,
            center.stopCommand,
            center.changeRepeatModeCommand,
            center.changeShuffleModeCommand,
            center.likeCommand,
            center.dislikeCommand,
            center.bookmarkCommand,
            center.ratingCommand,
            center.enableLanguageOptionCommand,
            center.disableLanguageOptionCommand,
        ] {
            unsupported.isEnabled = false
        }

        addTarget(center.playCommand) { [weak self] _ in
            self?.onMain { self?.play() } ?? .commandFailed
        }
        addTarget(center.pauseCommand) { [weak self] _ in
            self?.onMain { self?.pause() } ?? .commandFailed
        }
        addTarget(center.skipForwardCommand) { [weak self] _ in
            self?.onMain { self?.skipForward(30) } ?? .commandFailed
        }
        addTarget(center.skipBackwardCommand) { [weak self] _ in
            self?.onMain { self?.skipBackward(30) } ?? .commandFailed
        }
        addTarget(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self else { return .commandFailed }
            return onMain { self.isPlaying ? self.pause() : self.play() }
        }
        addTarget(center.nextTrackCommand) { [weak self] _ in
            self?.onMain { self?.nextChapter() } ?? .commandFailed
        }
        addTarget(center.previousTrackCommand) { [weak self] _ in
            self?.onMain { self?.prevChapter() } ?? .commandFailed
        }
        addTarget(center.changePlaybackRateCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackRateCommandEvent else {
                return .commandFailed
            }
            return self?.onMain { self?.setRate(event.playbackRate) } ?? .commandFailed
        }
        addTarget(center.changePlaybackPositionCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            return self?.onMain { self?.seek(to: event.positionTime) } ?? .commandFailed
        }
    }
}
