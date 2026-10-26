import AVFoundation
import Foundation
import MediaPlayer
import RawkoonKit
import UIKit

/// Physical file queue, observers, and chapter advance.
extension AudiobookPlayer {
    func buildQueue(at wholeBookPosition: Double, autoplay: Bool) {
        streamRetryPending = false
        guard let timeline, let manifest else { return }
        guard !chapters.isEmpty else {
            tearDownObservers()
            player = nil
            positionSecs = 0
            setCurrentChapter(index: nil)
            setPlaying(false)
            isSeeking = false
            return
        }

        let clamped = timeline.clamp(wholeBookPosition)
        if let castRoute {
            positionSecs = clamped
            setCurrentChapter(index: timeline.chapterIndex(at: clamped))
            castRoute.load(at: clamped, autoplay: autoplay)
            return
        }
        guard let chapter = chapter(forWholeBookPosition: clamped),
              let file = filesById[chapter.fileId]
        else {
            tearDownObservers()
            player = nil
            positionSecs = clamped
            setCurrentChapter(index: nil)
            setPlaying(false)
            isSeeking = false
            return
        }

        // Only the file being played. A single-file audiobook is one item that
        // spans many chapters; a multi-file book is one item per file. The next
        // file is started explicitly from `handleItemDidPlayToEnd`, never with
        // `.advance`, which is how an unplayable next item skipped to the last.
        var items: [AVPlayerItem] = []
        var mapping: [ObjectIdentifier: ManifestFile] = [:]
        if let mediaURL = playbackURL(for: file, editionId: manifest.editionId) {
            let item = makePlayerItem(url: mediaURL)
            item.audioTimePitchAlgorithm = .spectral
            items.append(item)
            mapping[ObjectIdentifier(item)] = file
        }

        guard !items.isEmpty else {
            tearDownObservers()
            player = nil
            positionSecs = clamped
            setCurrentChapter(index: nil)
            setPlaying(false)
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
        itemFiles = mapping
        queuedItem = items.first
        handledFailedItem = nil

        // Offset within the physical file, not the chapter: for a single-file
        // book the file's t=0 is the whole book's start, so the offset is
        // measured from the file, and the chapter is only a timeline marker.
        let offset = max(0, min(clamped - file.startSecs, max(file.durationSecs, 0)))
        positionSecs = clamped
        setCurrentChapter(chapter)
        setPlaying(autoplay)
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

    func tearDownObservers() {
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
        guard !isSeeking, !streamRetryPending, rawSeconds.isFinite else { return }
        // A tick queued before the item left the queue carries that file's
        // in-file time; read as a whole-book position it would point at the
        // wrong chapter. Keep the last valid position and resolve the queue.
        guard player?.currentItem != nil else {
            if isPlaying {
                handleQueueEmptied()
            }
            updateNowPlayingInfo()
            return
        }
        let clamped = timeline?.clamp(wholeBookPosition(fromCurrentItemTime: rawSeconds)) ?? max(rawSeconds, 0)
        positionSecs = clamped
        advanceSleep()
        // The item can span many chapters (single-file book), so the marker is
        // derived from the whole-book position, not from the item.
        setCurrentChapter(index: timeline?.chapterIndex(at: clamped))
        updateNowPlayingInfo()
    }

    private func handleCurrentItemChanged() {
        guard !isSeeking, !streamRetryPending, let player else { return }
        if let file = file(for: player.currentItem) {
            if let currentTime = player.currentItem?.currentTime().seconds, currentTime.isFinite {
                let clamped = timeline?.clamp(file.startSecs + max(currentTime, 0)) ?? max(currentTime, 0)
                positionSecs = clamped
            }
            setCurrentChapter(index: timeline?.chapterIndex(at: positionSecs))
        } else if player.currentItem == nil {
            handleQueueEmptied()
        }
        updateNowPlayingInfo()
    }

    /// A physical file ended. The only legal next step is the first chapter of
    /// the next file, or stop — never walking the rest of the playlist. The
    /// advance decision is anchored on the LAST chapter of the ended file, so a
    /// single-file book (one item, many chapters) correctly finishes the book.
    private func handleItemDidPlayToEnd(_ identifier: ObjectIdentifier) {
        guard !isSeeking, let endedFile = itemFiles[identifier],
              let ended = chapters.last(where: { $0.fileId == endedFile.id })
        else { return }
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
        // The queued item, not `currentItem`: the queue may already have
        // dropped it, and an older queue's item must not be resolved here.
        guard !isSeeking, let item = queuedItem, ObjectIdentifier(item) == identifier else { return }
        handleFailedItem(item)
    }

    private func applyChapterAdvance(_ decision: ChapterAdvanceDecision) {
        switch decision {
        case .finishedBook:
            finishBook()
        case let .playNext(index):
            guard let next = chapter(forIndex: index) else {
                reportUnplayableFile(nil, reason: nil)
                return
            }
            setPlaying(true)
            seek(to: next.startSecs, userInitiated: false)
        case let .stopWithError(index, title):
            stopWithUnplayableChapter(index: index, title: title, reason: nil)
        }
    }

    func applyQueueDrained() {
        switch queueDrainedDecision(
            endedIndex: currentChapterIndex,
            lastIndex: chapters.last?.index,
            positionSecs: positionSecs,
            durationSecs: duration
        ) {
        case .treatAsFinished:
            finishBook()
        case .stopWithError:
            let next = chapters.first { chapter in
                guard let current = currentChapterIndex else { return true }
                return chapter.index > current
            }
            stopWithUnplayableChapter(
                index: next?.index ?? currentChapterIndex ?? 0,
                title: next?.title ?? "",
                reason: nil
            )
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
        guard let manifest, let file = filesById[chapter.fileId] else { return false }
        return playbackURL(for: file, editionId: manifest.editionId) != nil
    }

    private func stopWithUnplayableChapter(index: Int, title: String, reason: PlaybackStopReason?) {
        playbackError = unplayableMessage(title: title.trimmingCharacters(in: .whitespacesAndNewlines), reason: reason)
        stopPlayback()
        Log.playback.error(
            """
            Stopped: chapter is unplayable: \
            chapterIndex=\(index, privacy: .public) \
            reason=\(String(describing: reason), privacy: .public) \
            title=\(title, privacy: .public)
            """
        )
        updateNowPlayingInfo()
    }

    /// Surfaces a file that could not play, labelled by its first chapter so
    /// the listener sees a chapter title rather than a file id.
    func reportUnplayableFile(_ file: ManifestFile?, reason: PlaybackStopReason?) {
        let chapter = file.flatMap { audioFile in chapters.first { $0.fileId == audioFile.id } }
        stopWithUnplayableChapter(index: chapter?.index ?? -1, title: chapter?.title ?? "", reason: reason)
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
    private func playbackURL(for file: ManifestFile, editionId: Int) -> URL? {
        let ext = file.fileExtension
        if FileStore.exists(editionId: editionId, fileId: file.id, ext: ext) {
            let url = FileStore.chapterURL(editionId: editionId, fileId: file.id, ext: ext)
            // Failed to open this session: stream but keep the file — the
            // failure may be transient and it may be the only offline copy.
            if recoveredFileIds.contains(file.id) {
                return resolvedRemoteURL(for: file)
            }
            if FileStore.size(url: url) == file.sizeBytes {
                return url
            }
            // Wrong size proves the file is broken, so drop it and stream.
            FileStore.delete(url: url)
        }
        return resolvedRemoteURL(for: file)
    }

    private func resolvedRemoteURL(for file: ManifestFile) -> URL? {
        if let resolved = URL(string: file.url, relativeTo: baseURL)?.absoluteURL {
            return resolved
        }
        if let absolute = URL(string: file.url), absolute.scheme != nil {
            return absolute
        }
        return nil
    }

    func file(for item: AVPlayerItem?) -> ManifestFile? {
        guard let item else { return nil }
        return itemFiles[ObjectIdentifier(item)]
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

    func wholeBookPosition(fromCurrentItemTime currentItemTime: Double) -> Double {
        guard
            let file = file(for: player?.currentItem),
            currentItemTime.isFinite
        else {
            return currentItemTime
        }
        return file.startSecs + max(currentItemTime, 0)
    }

    func applyPitchAlgorithm() {
        player?.currentItem?.audioTimePitchAlgorithm = .spectral
        for item in player?.items() ?? [] {
            item.audioTimePitchAlgorithm = .spectral
        }
    }
}
