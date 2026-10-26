import AVFoundation
import Foundation
import MediaPlayer
import Observation
import RawkoonKit
import UIKit

@Observable
final class AudiobookPlayer {
    var positionSecs: Double = 0 {
        didSet { onPositionTick?() }
    }

    private(set) var isPlaying = false {
        didSet {
            if oldValue != isPlaying {
                updateSleepLiveActivity()
            }
            // Combine sink was .dropFirst().removeDuplicates(), fired on !isPlaying:
            // i.e. only on an actual playing→paused transition.
            if oldValue, !isPlaying {
                onPlaybackStopped?()
            }
        }
    }

    private(set) var currentChapterIndex: Int?
    private(set) var currentChapter: ManifestChapter?
    var rate: Float = 1.0
    private(set) var duration: Double = 0
    /// Set when the next chapter cannot play. Cleared on a new load, seek, or
    /// the listener dismissing the alert. Never used to skip ahead.
    var playbackError: String?

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

    var sleepMode: SleepMode = .off
    var sleepRemainingSecs: Double?

    var sleepEndChapterIndex: Int?
    var lastSleepTick: Date?
    static let sleepFadeWindow: Double = 8
    let sleepLiveActivity = SleepLiveActivityController()

    /// When playback last stopped, for smart rewind. Nil while playing.
    var pausedAt: Date?
    /// Whether an interruption arrived while we were playing, so `.ended` knows
    /// whether resuming is even appropriate.
    var wasPlayingBeforeInterruption = false
    private var interruptionObserver: NSObjectProtocol?
    /// The remote-command targets this instance registered, so `deinit` can
    /// remove exactly those.
    var commandTargets: [(command: MPRemoteCommand, target: Any)] = []
    private var resetObserver: NSObjectProtocol?

    var artworkURL: URL?
    var artwork: MPMediaItemArtwork?
    var artworkTask: Task<Void, Never>?

    var player: AVQueuePlayer?
    var timeline: BookTimeline?
    var manifest: BookManifest?
    var baseURL: URL?
    var chapters: [ManifestChapter] = []
    /// The download+playback unit. A multi-file book has one file per chapter;
    /// a single-file audiobook has one file that many chapters index into.
    var filesById: [Int: ManifestFile] = [:]
    var itemFiles: [ObjectIdentifier: ManifestFile] = [:]
    var timeObserver: Any?
    var endObserver: NSObjectProtocol?
    var failedEndObserver: NSObjectProtocol?
    var currentItemObserver: NSKeyValueObservation?
    var itemStatusObserver: NSKeyValueObservation?
    /// Bumped on every seek so a stale completion cannot play() after a newer seek.
    var seekID = 0
    /// While true, ticks and current-item KVO must not overwrite `positionSecs`.
    var isSeeking = false
    /// Chapters whose unreadable local file was already discarded once this
    /// session, so a chapter that fails for another reason cannot loop.
    var recoveredFileIds: Set<Int> = []
    /// When each file's stream was last retried, so a stream that keeps
    /// failing stops instead of looping.
    var streamRetriedAt: [Int: Date] = [:]
    /// The item the queue was built with, kept so a failure can be resolved
    /// even after AVQueuePlayer has already dropped it from `currentItem`.
    var queuedItem: AVPlayerItem?
    /// The last item whose failure was handled, so the status KVO, the
    /// failed-to-end notification and a drained queue resolve it only once.
    var handledFailedItem: ObjectIdentifier?
    /// True while a failed stream waits for fresh URLs. Ticks are ignored and
    /// seeks only move the target, so the retry resumes where the listener is.
    var streamRetryPending = false
    /// Set while a Cast receiver has the book: controls go there, and its
    /// status comes back through `applyCastStatus`.
    var castRoute: (any AudiobookCastRoute)?

    /// Fresh signed URLs for an edition, or nil when they cannot be had.
    /// Set by AppModel; a cached manifest's grants expire after seven days.
    var refreshManifest: ((Int) async -> BookManifest?)?
    /// Whether the network is up. Set by AppModel.
    var isNetworkAvailable: () -> Bool = { true }

    /// The playback and queue extensions coordinate through these mutations;
    /// callers still observe the values without setting them directly.
    func setPlaying(_ value: Bool) {
        isPlaying = value
    }

    func setDuration(_ value: Double) {
        duration = value
    }

    func setCurrentChapter(_ chapter: ManifestChapter?) {
        currentChapter = chapter
        currentChapterIndex = chapter?.index
    }

    func setCurrentChapter(index: Int?) {
        currentChapterIndex = index
        currentChapter = index.flatMap { index in chapters.first(where: { $0.index == index }) }
    }

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
        guard castRoute == nil, let manifest, let baseURL else { return }
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
        // A call on the phone has nothing to do with the receiver's audio.
        guard castRoute == nil else { return }
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
            seek(to: target, userInitiated: false)
            return
        }
        beginPlayback()
    }
}
