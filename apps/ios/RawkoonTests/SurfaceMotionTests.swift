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
}
