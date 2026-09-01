import AVFoundation
import Foundation
import MediaPlayer
import RawkoonKit
import UIKit

final class AudiobookPlayer: ObservableObject {
    @Published private(set) var positionSecs: Double = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var currentChapterIndex: Int?
    @Published private(set) var currentChapter: ManifestChapter?
    @Published private(set) var rate: Float = 1.0
    @Published private(set) var duration: Double = 0

    // Sleep timer. Countdown advances on playback ticks, so it naturally pauses
    // when playback pauses. `.endOfChapter` stops when the current chapter ends.
    enum SleepMode: Equatable {
        case off
        case minutes(Int)
        case endOfChapter
    }
    @Published private(set) var sleepMode: SleepMode = .off
    @Published private(set) var sleepRemainingSecs: Double?

    private var sleepEndChapterIndex: Int?
    private var lastSleepTick: Date?
    private static let sleepFadeWindow: Double = 8

    /// When playback last stopped, for smart rewind. Nil while playing.
    private var pausedAt: Date?
    /// Whether an interruption arrived while we were playing, so `.ended` knows
    /// whether resuming is even appropriate.
    private var wasPlayingBeforeInterruption = false
    private var interruptionObserver: NSObjectProtocol?

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
    private var currentItemObserver: NSKeyValueObservation?
    private var itemStatusObserver: NSKeyValueObservation?
    /// Bumped on every seek so a stale completion cannot play() after a newer seek.
    private var seekID = 0
    /// While true, ticks and current-item KVO must not overwrite `positionSecs`.
    private var isSeeking = false

    init() {
        configureAudioSession()
        observeInterruptions()
        configureRemoteCommands()
    }

    deinit {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
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
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .spokenAudio,
                policy: .longFormAudio
            )
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
    /// Route disconnects come through here as well. Since iOS 17 the system
    /// interrupts an active Now Playing session when the route drops, so pulling
    /// AirPods out or losing the car's Bluetooth lands in this handler with no
    /// `.shouldResume`, and the book stays paused instead of playing on out of
    /// the phone's speaker.
    private func observeInterruptions() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            self?.handleInterruption(notification)
        }
    }

    private func handleInterruption(_ notification: Notification) {
        guard
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }

        switch type {
        case .began:
            // The system has already stopped the audio; only the published
            // state is left to correct, or the UI claims to be playing in
            // silence.
            wasPlayingBeforeInterruption = isPlaying
            if isPlaying { pause() }
        case .ended:
            guard wasPlayingBeforeInterruption else { return }
            wasPlayingBeforeInterruption = false
            let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            guard options.contains(.shouldResume) else { return }
            play()
        @unknown default:
            break
        }
    }

    func load(manifest: BookManifest, baseURL: URL, resumeAt: Double, artworkURL: URL? = nil) {
        self.manifest = manifest
        self.baseURL = baseURL
        loadArtwork(from: artworkURL)
        self.chapters = manifest.chapters.sorted { $0.index < $1.index }
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
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        // Now that no player item is left, the session can actually be released
        // — and other apps are told they may resume.
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
    }

    func play() {
        isPlaying = true
        if case .minutes = sleepMode { lastSleepTick = Date() }
        if player?.currentItem == nil, duration > 0 {
            seek(to: 0)
            return
        }
        // play() cancels an in-flight seek, which is the race that makes
        // scrubbing look like a no-op. Resume from the completion handler.
        if isSeeking {
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

    /// Pauses without deactivating the audio session.
    ///
    /// A paused book is still the Now Playing session: deactivating would tell
    /// every other app to resume, and `setActive(false)` is expected to fail
    /// anyway while an `AVPlayer` still holds a current item. The session is
    /// released in `unload()`, once the queue is gone.
    func pause() {
        player?.pause()
        isPlaying = false
        pausedAt = Date()
        updateNowPlayingInfo()
    }

    func seek(to seconds: Double) {
        guard let timeline else { return }
        // Any deliberate move — a scrub, a chapter jump, a skip — replaces
        // "resume where you stopped", so there is nothing left to rewind to.
        // Without this, pausing, jumping to a chapter and pressing play would
        // rewind off the front of the chapter the listener just chose.
        pausedAt = nil
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
        guard let player else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Audio session activation failures should not crash playback controls.
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
                guard let self, self.seekID == id else { return }
                self.isSeeking = false
                guard finished else { return }
                if self.isPlaying {
                    self.beginPlayback()
                } else {
                    self.updateNowPlayingInfo()
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
            isSeeking = false
        default:
            isSeeking = true
            isPlaying = autoplay
            itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
                DispatchQueue.main.async {
                    guard let self, self.seekID == id else { return }
                    switch item.status {
                    case .readyToPlay:
                        self.itemStatusObserver = nil
                        self.seekCurrentItem(to: offset, autoplay: self.isPlaying)
                    case .failed:
                        self.itemStatusObserver = nil
                        self.isSeeking = false
                    default:
                        break
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

        guard let startArrayIndex = chapters.firstIndex(where: { $0.index == chapter.index }) else {
            return
        }

        let queueChapters = Array(chapters[startArrayIndex...])
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
        queuePlayer.actionAtItemEnd = .advance
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
            self?.handleTick(time.seconds)
        }

        currentItemObserver = player.observe(\.currentItem, options: [.initial, .new]) { [weak self] _, _ in
            self?.handleCurrentItemChanged()
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard
                let self,
                let item = notification.object as? AVPlayerItem,
                self.itemChapters[ObjectIdentifier(item)] != nil
            else {
                return
            }
            self.handleCurrentItemChanged()
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
            setCurrentChapter(index: timeline?.chapterIndex(at: clamped) ?? chapters.last?.index)
        }
        if isPlaying, player?.currentItem == nil {
            isPlaying = false
            positionSecs = duration
            setCurrentChapter(index: chapters.last?.index)
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
            isPlaying = false
            positionSecs = duration
            setCurrentChapter(index: chapters.last?.index)
        }
        updateNowPlayingInfo()
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
        let ext = fileExtension(for: chapter)
        if FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: ext) {
            let url = FileStore.chapterURL(editionId: editionId, fileId: chapter.fileId, ext: ext)
            if FileStore.size(url: url) == chapter.sizeBytes {
                return url
            }
            FileStore.delete(url: url)
        }
        return resolvedRemoteURL(for: chapter)
    }

    private func fileExtension(for chapter: ManifestChapter) -> String {
        let pathExt = URL(string: chapter.url, relativeTo: baseURL)?.pathExtension
            ?? URL(string: chapter.url)?.pathExtension
            ?? ""
        return pathExt.isEmpty ? "bin" : pathExt
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
            // Chapter numbering is zero-based, and so is ManifestChapter.index.
            if let index = currentChapterIndex {
                info[MPNowPlayingInfoPropertyChapterNumber] = index
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
            guard
                let (data, _) = try? await URLSession.shared.data(from: url),
                !Task.isCancelled,
                let image = UIImage(data: data)
            else { return }
            await MainActor.run {
                guard let self, self.artworkURL == url else { return }
                self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.updateNowPlayingInfo()
            }
        }
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
    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.removeTarget(nil)
        center.pauseCommand.removeTarget(nil)
        center.togglePlayPauseCommand.removeTarget(nil)
        center.skipForwardCommand.removeTarget(nil)
        center.skipBackwardCommand.removeTarget(nil)
        center.nextTrackCommand.removeTarget(nil)
        center.previousTrackCommand.removeTarget(nil)
        center.changePlaybackPositionCommand.removeTarget(nil)
        center.changePlaybackRateCommand.removeTarget(nil)

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
        ] {
            unsupported.isEnabled = false
        }

        center.playCommand.addTarget { [weak self] _ in
            self?.play()
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        center.skipForwardCommand.addTarget { [weak self] _ in
            self?.skipForward(30)
            return .success
        }
        center.skipBackwardCommand.addTarget { [weak self] _ in
            self?.skipBackward(30)
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            isPlaying ? pause() : play()
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.nextChapter()
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.prevChapter()
            return .success
        }
        center.changePlaybackRateCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackRateCommandEvent else {
                return .commandFailed
            }
            self?.setRate(event.playbackRate)
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.seek(to: event.positionTime)
            return .success
        }
    }
}
