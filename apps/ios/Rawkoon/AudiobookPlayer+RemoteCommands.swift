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
    /// transport method here writes state that SwiftUI and `AppModel`'s progress
    /// sink read on the main actor. The handlers are built by the `nonisolated`
    /// factories below and hop inside: a closure written in this MainActor code
    /// would carry an isolation check that traps when the SDK calls it off-main
    /// (the same trap as the Now Playing artwork handler).
    private typealias CommandHandler = (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus

    private func addTarget(_ command: MPRemoteCommand, _ handler: @escaping CommandHandler) {
        commandTargets.append((command, command.addTarget(handler: handler)))
    }

    private nonisolated static func dispatch(
        _ player: AudiobookPlayer,
        _ work: @escaping @MainActor @Sendable (AudiobookPlayer) -> Void
    ) -> MPRemoteCommandHandlerStatus {
        if Thread.isMainThread {
            MainActor.assumeIsolated { work(player) }
        } else {
            Task { @MainActor in work(player) }
        }
        return .success
    }

    private nonisolated static func simpleHandler(
        _ player: AudiobookPlayer,
        _ work: @escaping @MainActor @Sendable (AudiobookPlayer) -> Void
    ) -> CommandHandler {
        { [weak player] _ in
            guard let player else { return .commandFailed }
            return dispatch(player, work)
        }
    }

    private nonisolated static func rateHandler(_ player: AudiobookPlayer) -> CommandHandler {
        { [weak player] event in
            guard let player, let event = event as? MPChangePlaybackRateCommandEvent else { return .commandFailed }
            let rate = event.playbackRate
            return dispatch(player) { $0.setRate(rate) }
        }
    }

    private nonisolated static func positionHandler(_ player: AudiobookPlayer) -> CommandHandler {
        { [weak player] event in
            guard let player, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            return dispatch(player) { $0.seek(to: position) }
        }
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

        addTarget(center.playCommand, Self.simpleHandler(self) { $0.play() })
        addTarget(center.pauseCommand, Self.simpleHandler(self) { $0.pause() })
        addTarget(center.skipForwardCommand, Self.simpleHandler(self) { $0.skipForward(30) })
        addTarget(center.skipBackwardCommand, Self.simpleHandler(self) { $0.skipBackward(30) })
        addTarget(center.togglePlayPauseCommand, Self.simpleHandler(self) { $0.isPlaying ? $0.pause() : $0.play() })
        addTarget(center.nextTrackCommand, Self.simpleHandler(self) { $0.nextChapter() })
        addTarget(center.previousTrackCommand, Self.simpleHandler(self) { $0.prevChapter() })
        addTarget(center.changePlaybackRateCommand, Self.rateHandler(self))
        addTarget(center.changePlaybackPositionCommand, Self.positionHandler(self))
    }
}
