@testable import Rawkoon
import SwiftUI
import Testing

@MainActor
struct ScreenMotionTests {
    @Test func artworkRestsAtFullSizeWhilePlaying() {
        #expect(PlayerMotion.artworkScale(isPlaying: true, reduceMotion: false) == 1)
    }

    @Test func artworkSitsBackALittleWhenPaused() {
        let paused = PlayerMotion.artworkScale(isPlaying: false, reduceMotion: false)
        #expect(paused == PlayerMotion.pausedArtworkScale)
        #expect(paused < 1)
        #expect(paused >= 0.85)
    }

    @Test func artworkStaysStillUnderReduceMotion() {
        #expect(PlayerMotion.artworkScale(isPlaying: false, reduceMotion: true) == 1)
    }

    @Test func sleepRollKeysOnTheMode() {
        #expect(PlayerMotion.sleepRollValue(isOff: true, remaining: 300) == 0)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: nil) == -1)
    }

    @Test func sleepRollTicksOncePerDisplayedSecond() {
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 299.6) == 300)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 299.4) == 299)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 0.2) == 1)
    }

    @Test func ebookRowDownloadWinsOverEveryOtherFace() {
        #expect(EbookFileAction.phase(downloading: true, opening: true, downloaded: true) == .downloading)
    }

    @Test func ebookRowOpensBeforeShowingActions() {
        #expect(EbookFileAction.phase(downloading: false, opening: true, downloaded: true) == .opening)
    }

    @Test func ebookRowActionsFollowTheDownload() {
        #expect(EbookFileAction.phase(downloading: false, opening: false, downloaded: true) == .saved)
        #expect(EbookFileAction.phase(downloading: false, opening: false, downloaded: false) == .remote)
    }

    @Test func ebookFilesSpinWhileLoadingEvenOverAList() {
        #expect(EbookFilesPhase.resolve(loading: true, isEmpty: false) == .loading)
        #expect(EbookFilesPhase.resolve(loading: false, isEmpty: true) == .empty)
        #expect(EbookFilesPhase.resolve(loading: false, isEmpty: false) == .list)
    }

    @Test func loginShowsWhileSignedOut() {
        #expect(LoginExit.showsLogin(isLoggedIn: false, exitFinished: false))
        #expect(LoginExit.showsLogin(isLoggedIn: false, exitFinished: true))
    }

    @Test func loginLingersUntilItsExitFinishes() {
        #expect(LoginExit.showsLogin(isLoggedIn: true, exitFinished: false))
        #expect(!LoginExit.showsLogin(isLoggedIn: true, exitFinished: true))
    }

    @Test func loginLingerCoversTheCelebration() {
        #expect(LoginExit.linger >= .milliseconds(440))
        #expect(LoginExit.linger <= .milliseconds(500))
    }

    @Test func signInFaceShowsTheCheckOnceTheSessionOpens() {
        #expect(SignInFace.face(loading: true, signedIn: true) == .signedIn)
        #expect(SignInFace.face(loading: true, signedIn: false) == .loading)
        #expect(SignInFace.face(loading: false, signedIn: false) == .idle)
    }

    @Test func connectionTestPlaysOneHapticPerResult() {
        #expect(TestOutcome.success(nil).haptic == .success)
        #expect(TestOutcome.success("Connected").haptic == .success)
        #expect(TestOutcome.failure("Could not connect.").haptic == .error)
    }

    @Test func connectionTestStateFollowsTheOutcome() {
        #expect(TestConnectionButton.TestState(.success("ok")) == .ok("ok"))
        #expect(TestConnectionButton.TestState(.success(nil)) == .ok(nil))
        #expect(TestConnectionButton.TestState(.failure("no")) == .failed("no"))
    }

    @Test func listSpinsOnlyWhileNothingIsCached() {
        #expect(listPhase(loading: true, isEmpty: true) == .loading)
        #expect(listPhase(loading: true, isEmpty: false) == .list)
    }

    @Test func listOfflineBeatsAPlainFailure() {
        #expect(listPhase(offline: true, failed: true, isEmpty: true) == .offline)
        #expect(listPhase(failed: true, isEmpty: true) == .failed)
    }

    @Test func listKeepsCachedRowsOverAnError() {
        #expect(listPhase(offline: true, failed: true, isEmpty: false) == .list)
    }

    @Test func listShowsEmptyWhenTheFilterLeavesNothing() {
        let phase = ListLoadPhase.resolve(
            loading: false, offline: false, failed: false, isEmpty: false, showsNothing: true
        )
        #expect(phase == .empty)
    }

    @Test func requestRowBusyWinsThenModerationThenStatus() {
        #expect(RequestRowFace.face(busy: true, canModerate: true, status: "pending") == .busy)
        #expect(RequestRowFace.face(busy: false, canModerate: true, status: "pending") == .moderate)
        #expect(RequestRowFace.face(busy: false, canModerate: false, status: "approved") == .status("approved"))
    }

    @Test func unreadBadgeRollsOnItsNumber() {
        #expect(UnreadBadge.rollValue("3") == 3)
        #expect(UnreadBadge.rollValue("9+") == 9)
        #expect(UnreadBadge.rollValue("") == 0)
    }

    private func listPhase(
        loading: Bool = false, offline: Bool = false, failed: Bool = false, isEmpty: Bool
    ) -> ListLoadPhase {
        ListLoadPhase.resolve(
            loading: loading, offline: offline, failed: failed, isEmpty: isEmpty, showsNothing: isEmpty
        )
    }
}
