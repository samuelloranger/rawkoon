@testable import Rawkoon
import Testing

@MainActor
struct SurfaceMotionTests {
    @Test func bellRingsWhenTheCountRises() {
        #expect(NotificationBell.announcesArrival(from: 0, to: 1))
        #expect(NotificationBell.announcesArrival(from: 3, to: 5))
    }

    @Test func bellStaysStillWhenNotificationsAreRead() {
        #expect(!NotificationBell.announcesArrival(from: 4, to: 0))
        #expect(!NotificationBell.announcesArrival(from: 2, to: 1))
        #expect(!NotificationBell.announcesArrival(from: 2, to: 2))
    }

    @Test func dealLandsTheBackCardFirst() {
        #expect(DeckDeal.delay(stackIndex: 2, visibleCount: 3) == 0)
        #expect(abs(DeckDeal.delay(stackIndex: 1, visibleCount: 3) - DeckDeal.step) < 1e-9)
        #expect(abs(DeckDeal.delay(stackIndex: 0, visibleCount: 3) - 2 * DeckDeal.step) < 1e-9)
    }

    @Test func aLoneCardDealsAtOnce() {
        #expect(DeckDeal.delay(stackIndex: 0, visibleCount: 1) == 0)
    }

    @Test func dealStaggerStaysShort() {
        for count in 0 ... 12 {
            for index in -1 ... 12 {
                let delay = DeckDeal.delay(stackIndex: index, visibleCount: count)
                #expect(delay >= 0)
                #expect(delay <= 2 * DeckDeal.step + 1e-9)
            }
        }
    }

    @Test func dealTiltAlternatesAndStaysSmall() {
        #expect(DeckDeal.startAngle(stackIndex: 0) == -DeckDeal.startAngle(stackIndex: 1))
        #expect(abs(DeckDeal.startAngle(stackIndex: 2)) <= 6)
    }

    @Test func downloadSheenRunsOnlyWhileBytesArrive() {
        #expect(DownloadMotion.isRunning(state: "downloading"))
        #expect(DownloadMotion.isRunning(state: "Downloading"))
        #expect(!DownloadMotion.isRunning(state: "paused"))
        #expect(!DownloadMotion.isRunning(state: "stalled"))
        #expect(!DownloadMotion.isRunning(state: "completed"))
        #expect(!DownloadMotion.isRunning(state: "error"))
    }

    @Test func downloadCompletionMatchesTheSeedingPhase() {
        #expect(DownloadMotion.isComplete(state: "completed"))
        #expect(DownloadMotion.isComplete(state: "seeding"))
        #expect(!DownloadMotion.isComplete(state: "downloading"))
        #expect(!DownloadMotion.isComplete(state: "paused"))
    }

    @Test func aiBannerLoadingWinsOverEveryOtherFace() {
        let phase = aiPhase(loading: true, budgetReached: true, failed: true, hasRelease: true, grabbed: true)
        #expect(phase == .loading)
    }

    @Test func aiBannerBudgetBeatsAFailure() {
        let phase = aiPhase(loading: false, budgetReached: true, failed: true, hasRelease: false, grabbed: false)
        #expect(phase == .budgetReached)
    }

    @Test func aiBannerFailureShowsWithoutAPick() {
        let phase = aiPhase(loading: false, budgetReached: false, failed: true, hasRelease: false, grabbed: false)
        #expect(phase == .failed)
    }

    @Test func aiBannerHidesWithoutAPickedRelease() {
        let phase = aiPhase(loading: false, budgetReached: false, failed: false, hasRelease: false, grabbed: true)
        #expect(phase == .hidden)
    }

    @Test func aiBannerShowsThePickThenGrabbed() {
        let picked = aiPhase(loading: false, budgetReached: false, failed: false, hasRelease: true, grabbed: false)
        let grabbed = aiPhase(loading: false, budgetReached: false, failed: false, hasRelease: true, grabbed: true)
        #expect(picked == .picked)
        #expect(grabbed == .grabbed)
    }

    private func aiPhase(
        loading: Bool, budgetReached: Bool, failed: Bool, hasRelease: Bool, grabbed: Bool
    ) -> AiPickBanner.Phase {
        AiPickBanner.phase(
            loading: loading, budgetReached: budgetReached, failed: failed, hasRelease: hasRelease, grabbed: grabbed
        )
    }
}
