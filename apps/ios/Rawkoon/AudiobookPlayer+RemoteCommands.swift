import Foundation
import MediaPlayer

/// MPRemoteCommandCenter wiring for lock screen, Control Center, headset, and
/// car controls. Split out of AudiobookPlayer.swift; behavior unchanged.
extension AudiobookPlayer {
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

    func configureRemoteCommands() {
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
