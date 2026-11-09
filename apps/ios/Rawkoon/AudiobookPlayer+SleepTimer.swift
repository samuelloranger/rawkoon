import AVFoundation
import Foundation

/// Sleep-timer countdown, fade, and firing. Split out of
/// AudiobookPlayer.swift; behavior unchanged.
extension AudiobookPlayer {
    // MARK: Sleep timer

    func setSleep(_ mode: SleepMode) {
        sleepMode = mode
        sleepEndChapterIndex = nil
        lastSleepTick = nil
        sleepBoundaryTask?.cancel()
        sleepBoundaryTask = nil
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
        updateSleepLiveActivity()
    }

    /// Called from the playback tick. Advances the countdown by real elapsed
    /// time while playing, fades the last few seconds, then pauses.
    func advanceSleep() {
        guard isPlaying else { lastSleepTick = Date(); return }

        switch sleepMode {
        case .off:
            return
        case .endOfChapter:
            guard let target = sleepEndChapterIndex else { return }
            if let current = currentChapterIndex, current > target {
                fireSleep()
            } else if let end = chapters.first(where: { $0.index == target })?.endSecs {
                scheduleSleepAtChapterEnd(target: target, secondsLeft: (end - positionSecs) / Double(max(rate, 0.1)))
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

    /// A tick lands every half second, so waiting for the position to cross into the next
    /// chapter lets up to a tick of it play. Inside a multi-chapter file, pause at the end instead.
    private func scheduleSleepAtChapterEnd(target: Int, secondsLeft: Double) {
        guard secondsLeft <= Self.sleepTickSecs else {
            sleepBoundaryTask?.cancel()
            sleepBoundaryTask = nil
            return
        }
        guard sleepBoundaryTask == nil else { return }
        sleepBoundaryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(secondsLeft, 0)))
            guard !Task.isCancelled, let self, isPlaying,
                  sleepMode == .endOfChapter, sleepEndChapterIndex == target
            else { return }
            fireSleep()
        }
    }

    func fireSleep() {
        sleepBoundaryTask?.cancel()
        sleepBoundaryTask = nil
        pause()
        resetSleepVolume()
        sleepMode = .off
        sleepRemainingSecs = nil
        sleepEndChapterIndex = nil
        lastSleepTick = nil
        sleepLiveActivity.end()
    }

    func updateSleepLiveActivity() {
        guard case .minutes = sleepMode else {
            sleepLiveActivity.end()
            return
        }
        sleepLiveActivity.sync(
            bookTitle: manifest?.title,
            chapterTitle: currentChapter?.title,
            remaining: sleepRemainingSecs,
            isPlaying: isPlaying
        )
    }

    private func resetSleepVolume() {
        player?.volume = 1
    }
}
