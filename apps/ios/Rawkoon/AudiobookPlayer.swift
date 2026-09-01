import AVFoundation
import Foundation
import MediaPlayer
import RawkoonKit

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
        configureRemoteCommands()
    }

    deinit {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
    }

    func load(manifest: BookManifest, baseURL: URL, resumeAt: Double) {
        self.manifest = manifest
        self.baseURL = baseURL
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
        load(manifest: manifest, baseURL: baseURL, resumeAt: resumeAt)
        if resumePlaying {
            play()
        }
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
        beginPlayback()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        updateNowPlayingInfo()
    }

    func seek(to seconds: Double) {
        guard let timeline else { return }
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
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .spokenAudio)
            try audioSession.setActive(true)
        } catch {
            // Audio session activation failures should not crash playback controls.
        }
        player.play()
        player.rate = rate
        updateNowPlayingInfo()
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
        info[MPMediaItemPropertyTitle] = manifest.title
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionSecs
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.removeTarget(nil)
        center.pauseCommand.removeTarget(nil)
        center.skipForwardCommand.removeTarget(nil)
        center.skipBackwardCommand.removeTarget(nil)
        center.changePlaybackPositionCommand.removeTarget(nil)

        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.skipForwardCommand.isEnabled = true
        center.skipBackwardCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipBackwardCommand.preferredIntervals = [30]

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
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.seek(to: event.positionTime)
            return .success
        }
    }
}
