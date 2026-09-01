import Foundation

/// How far to rewind when playback resumes after a pause.
///
/// Coming back to a book — after a navigation prompt, a phone call, or a night's
/// sleep — you have lost the thread of the sentence you were on, and the longer
/// you were away the more of it you have lost. The offset is a step function
/// rather than a curve because the listener has to be able to predict it: the
/// same gap always costs the same rewind.
///
/// A very short gap rewinds nothing. Pausing to answer a question and pressing
/// play again should resume where the voice stopped, not talk over itself.
public func smartRewindOffset(pausedFor seconds: Double) -> Double {
    guard seconds.isFinite, seconds > 0 else { return 0 }
    switch seconds {
    case ..<10: return 0
    case ..<60: return 2
    case ..<3600: return 10
    default: return 20
    }
}
