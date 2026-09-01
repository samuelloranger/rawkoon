import XCTest
@testable import RawkoonKit

final class InterruptionPolicyTests: XCTestCase {
    private let playing = InterruptionState(isPlaying: true)

    func testPromptStopsPlaybackAndRemembersToResume() {
        let (action, state) = interruptionDecision(.began, state: playing)
        XCTAssertEqual(action, .stopPlayback)
        XCTAssertTrue(state.resumePending)
        XCTAssertFalse(state.isPlaying)
    }

    func testPromptEndingResumes() {
        let (_, interrupted) = interruptionDecision(.began, state: playing)
        let (action, state) = interruptionDecision(.ended(shouldResume: true), state: interrupted)
        XCTAssertEqual(action, .resumePlayback)
        XCTAssertFalse(state.resumePending)
        XCTAssertTrue(state.isPlaying)
    }

    /// The Maps bug, and the shape it came back in: a call arriving while a
    /// navigation prompt is still speaking. Playback is already stopped by the
    /// second `.began`, and only one `.ended` follows for both.
    func testCallDuringNavigationPromptStillResumes() {
        let (_, afterPrompt) = interruptionDecision(.began, state: playing)
        let (action, afterCall) = interruptionDecision(.began, state: afterPrompt)
        XCTAssertEqual(action, .doNothing)
        XCTAssertTrue(afterCall.resumePending, "a nested interruption must not forget the resume")

        let (resumed, _) = interruptionDecision(.ended(shouldResume: true), state: afterCall)
        XCTAssertEqual(resumed, .resumePlayback)
    }

    /// Pausing during the prompt is a decision, not an accident.
    func testUserPauseDuringAnInterruptionWins() {
        let (_, interrupted) = interruptionDecision(.began, state: playing)
        let paused = userPaused(interrupted)
        let (action, _) = interruptionDecision(.ended(shouldResume: true), state: paused)
        XCTAssertEqual(action, .doNothing)
    }

    /// A route disconnect arrives as an interruption carrying no hint. Pulling
    /// headphones out must not restart the book out of the phone's speaker.
    func testEndWithoutTheHintStaysPaused() {
        let (_, interrupted) = interruptionDecision(.began, state: playing)
        let (action, state) = interruptionDecision(.ended(shouldResume: false), state: interrupted)
        XCTAssertEqual(action, .doNothing)
        XCTAssertFalse(state.resumePending, "the flag is spent either way")
    }

    func testInterruptionWhilePausedChangesNothing() {
        let paused = InterruptionState(isPlaying: false)
        let (began, afterBegan) = interruptionDecision(.began, state: paused)
        XCTAssertEqual(began, .doNothing)
        XCTAssertFalse(afterBegan.resumePending)

        let (ended, _) = interruptionDecision(.ended(shouldResume: true), state: afterBegan)
        XCTAssertEqual(ended, .doNothing, "nothing was playing, so nothing resumes")
    }

    /// A stray `.ended` long after the flag was spent must not start playback.
    func testSecondEndDoesNotResumeAgain() {
        let (_, interrupted) = interruptionDecision(.began, state: playing)
        let (_, afterFirst) = interruptionDecision(.ended(shouldResume: true), state: interrupted)
        let (action, _) = interruptionDecision(.ended(shouldResume: true), state: afterFirst)
        XCTAssertEqual(action, .doNothing)
    }
}
