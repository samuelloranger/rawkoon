import AVFoundation
import Foundation
import MediaPlayer
import RawkoonKit

final class AudiobookPlayer: ObservableObject {
    @Published private(set) var positionSecs: Double = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var currentChapterIndex: Int?
    @Published private(set) var rate: Float = 1.0
    @Published private(set) var duration: Double = 0

    private var player: AVPlayer?
    private var timeline: BookTimeline?
    private var manifest: BookManifest?
    private var missingChapterIndices: Set<Int> = []
    private var missingChapterStarts: [Double] = []
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var lastObservedPositionSecs: Double?

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

    func load(manifest: BookManifest, resumeAt: Double) {
        tearDownObservers()

        self.manifest = manifest
        let chapters = manifest.chapters.sorted { $0.index < $1.index }
        let timeline = BookTimeline(chapters: chapters)
        self.timeline = timeline
        duration = timeline.totalDurationSecs
        missingChapterIndices = Set(
            chapters.filter { isChapterMissing($0, editionId: manifest.editionId) }.map(\.index)
        )
        missingChapterStarts = chapters.filter { missingChapterIndices.contains($0.index) }.map(\.startSecs)

        let composition = AVMutableComposition()
        let destinationTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)

        var insertionPoint = CMTime.zero
        for chapter in chapters {
            let chapterDuration = CMTime(seconds: max(chapter.durationSecs, 0), preferredTimescale: 600)
            guard chapterDuration.seconds > 0 else { continue }

            if let destinationTrack, let sourceTrack = sourceTrack(for: chapter) {
                do {
                    try destinationTrack.insertTimeRange(
                        CMTimeRange(start: .zero, duration: chapterDuration),
                        of: sourceTrack,
                        at: insertionPoint
                    )
                } catch {
                    composition.insertEmptyTimeRange(CMTimeRange(start: insertionPoint, duration: chapterDuration))
                }
            } else {
                composition.insertEmptyTimeRange(CMTimeRange(start: insertionPoint, duration: chapterDuration))
            }

            insertionPoint = insertionPoint + chapterDuration
        }

        let item = AVPlayerItem(asset: composition)
        item.audioTimePitchAlgorithm = .spectral

        let player = AVPlayer(playerItem: item)
        self.player = player
        isPlaying = false

        let clamped = timeline.clamp(resumeAt)
        let seekTime = CMTime(seconds: clamped, preferredTimescale: 600)
        player.seek(to: seekTime, toleranceBefore: .zero, toleranceAfter: .zero)
        positionSecs = clamped
        lastObservedPositionSecs = clamped
        currentChapterIndex = timeline.chapterIndex(at: clamped)

        installObservers(player: player, item: item)
        updateNowPlayingInfo()
    }

    func rebuild() {
        guard let manifest else { return }
        let resumeAt = positionSecs
        let resumePlaying = isPlaying
        load(manifest: manifest, resumeAt: resumeAt)
        if resumePlaying {
            play()
        }
    }

    func play() {
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
        isPlaying = true
        updateNowPlayingInfo()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        updateNowPlayingInfo()
    }

    func seek(to seconds: Double) {
        guard let player, let timeline else { return }
        let clamped = timeline.clamp(seconds)
        player.seek(
            to: CMTime(seconds: clamped, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
        positionSecs = clamped
        lastObservedPositionSecs = clamped
        currentChapterIndex = timeline.chapterIndex(at: clamped)
        updateNowPlayingInfo()
    }

    func skipForward(_ seconds: Double = 30) {
        seek(to: positionSecs + seconds)
    }

    func skipBackward(_ seconds: Double = 30) {
        seek(to: positionSecs - seconds)
    }

    func setRate(_ value: Float) {
        rate = value
        player?.currentItem?.audioTimePitchAlgorithm = .spectral
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

    private func installObservers(player: AVPlayer, item: AVPlayerItem) {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            self?.handleTick(time.seconds)
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.isPlaying = false
            self.positionSecs = self.duration
            self.currentChapterIndex = self.timeline?.chapterIndex(at: self.duration)
            self.updateNowPlayingInfo()
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
    }

    private func handleTick(_ rawSeconds: Double) {
        guard rawSeconds.isFinite else { return }
        let previous = lastObservedPositionSecs ?? rawSeconds
        let clamped = timeline?.clamp(rawSeconds) ?? max(rawSeconds, 0)

        positionSecs = clamped
        lastObservedPositionSecs = clamped
        currentChapterIndex = timeline?.chapterIndex(at: clamped)

        if isPlaying {
            if let missingBoundary = crossedMissingBoundary(from: previous, to: clamped) {
                pause()
                seek(to: missingBoundary)
                return
            }
            if let currentChapterIndex, missingChapterIndices.contains(currentChapterIndex) {
                pause()
                return
            }
        }

        updateNowPlayingInfo()
    }

    private func crossedMissingBoundary(from previous: Double, to current: Double) -> Double? {
        for boundary in missingChapterStarts where previous < boundary && current >= boundary {
            return boundary
        }
        return nil
    }

    private func isChapterMissing(_ chapter: ManifestChapter, editionId: Int) -> Bool {
        let ext = fileExtension(for: chapter)
        return !FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: ext)
    }

    private func sourceTrack(for chapter: ManifestChapter) -> AVAssetTrack? {
        guard let manifest else { return nil }
        let ext = fileExtension(for: chapter)
        guard FileStore.exists(editionId: manifest.editionId, fileId: chapter.fileId, ext: ext) else {
            return nil
        }
        let url = FileStore.chapterURL(editionId: manifest.editionId, fileId: chapter.fileId, ext: ext)
        let asset = AVURLAsset(url: url)
        return asset.tracks(withMediaType: .audio).first
    }

    private func fileExtension(for chapter: ManifestChapter) -> String {
        let pathExt = URL(string: chapter.url)?.pathExtension ?? ""
        return pathExt.isEmpty ? "bin" : pathExt
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
