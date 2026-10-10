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
}
