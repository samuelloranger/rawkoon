import Foundation

/// What an audio-session interruption should do to playback.
///
/// This is a pure decision table rather than logic inside the player because
/// the interesting cases cannot be reproduced on a simulator: a call arriving
/// during a navigation prompt, a listener pausing while a prompt is speaking,
/// a route dropping mid-book. Each of those is one row here, and each row is a
/// test.
public enum InterruptionEvent: Equatable, Sendable {
    case began
    case ended(shouldResume: Bool)
}

/// The player state the decision depends on.
public struct InterruptionState: Equatable, Sendable {
    public var isPlaying: Bool
    /// Set when an interruption stopped playback that was running, so the end
    /// of that interruption knows there is something to go back to.
    public var resumePending: Bool

    public init(isPlaying: Bool, resumePending: Bool = false) {
        self.isPlaying = isPlaying
        self.resumePending = resumePending
    }
}

public enum InterruptionAction: Equatable, Sendable {
    case doNothing
    case stopPlayback
    case resumePlayback
}

/// Decides what an interruption does, and what it leaves behind.
///
/// The rules that matter, each learned from a way this went wrong:
///
/// - `.began` only ever *sets* the pending flag. A second interruption before
///   the first ends — a call during a navigation prompt — arrives with playback
///   already stopped, and the system sends a single `.ended` for the pair. A
///   `.began` that cleared the flag would lose the resume.
/// - `.ended` resumes only with the system's `.shouldResume` hint AND a pending
///   resume of our own. The hint alone is not enough: a listener who pauses
///   during the prompt has said what they want.
/// - Either way `.ended` clears the flag, so a later unrelated `.ended` cannot
///   restart a book nobody is listening to.
public func interruptionDecision(
    _ event: InterruptionEvent,
    state: InterruptionState
) -> (action: InterruptionAction, state: InterruptionState) {
    var next = state
    switch event {
    case .began:
        guard state.isPlaying else { return (.doNothing, next) }
        next.resumePending = true
        next.isPlaying = false
        return (.stopPlayback, next)

    case let .ended(shouldResume):
        guard state.resumePending else { return (.doNothing, next) }
        next.resumePending = false
        guard shouldResume else { return (.doNothing, next) }
        next.isPlaying = true
        return (.resumePlayback, next)
    }
}

/// A pause the listener asked for abandons any pending resume: they heard the
/// prompt and decided the book should stay off.
public func userPaused(_: InterruptionState) -> InterruptionState {
    InterruptionState(isPlaying: false, resumePending: false)
}
