@testable import Rawkoon
import RawkoonKit
import Testing

@MainActor
struct NotificationDestinationTests {
    @Test func settingsPathsRouteToTheirScreens() {
        #expect(NotificationDestination.resolve(url: "/settings/reencode") == .settings(.reencode))
        #expect(NotificationDestination.resolve(url: "/settings/alerts") == .settings(.alerts))
        #expect(NotificationDestination.resolve(url: "/settings/updates") == .settings(.releases))
        #expect(NotificationDestination.resolve(url: "/settings/connections") == .settings(.downloadClient))
        #expect(NotificationDestination.resolve(url: "/settings/after-download") == .settings(.seeding))
        #expect(NotificationDestination.resolve(url: "/settings/general") == .settings(.general))
        #expect(NotificationDestination.resolve(url: "/settings/quality") == .settingsGroup(.quality))
        #expect(NotificationDestination.resolve(url: "/settings/books") == .settingsGroup(.books))
        #expect(NotificationDestination.resolve(url: "/settings/customFormats") == .settings(.customFormats))
        #expect(NotificationDestination.resolve(url: "/settings/profile") == .profile)
        #expect(NotificationDestination.resolve(url: "/settings/system") == nil)
        #expect(NotificationDestination.resolve(url: "/settings/nope") == nil)
    }

    @Test func legacySettingsTabsStillRoute() {
        #expect(NotificationDestination.resolve(url: "/settings?tab=transcode") == .settings(.reencode))
        #expect(NotificationDestination.resolve(url: "/settings?tab=users") == nil)
        #expect(NotificationDestination.resolve(url: "/settings") == .tab(.settings))
    }

    @Test func activityPathsRoute() {
        #expect(NotificationDestination.resolve(url: "/activity/requests") == .requests)
        #expect(NotificationDestination.resolve(url: "/requests") == .requests)
        #expect(NotificationDestination.resolve(url: "/activity/calendar?date=2026-10-16") == .calendar(date: "2026-10-16"))
        #expect(NotificationDestination.resolve(url: "/activity/history") == .history)
        #expect(NotificationDestination.resolve(url: "/activity/queue") == .queue)
    }

    @Test func onlyServerSettingsAreAdminOnly() {
        #expect(NotificationDestination.settings(.health).isAdminOnly)
        #expect(NotificationDestination.settingsGroup(.people).isAdminOnly)
        #expect(!NotificationDestination.settings(.alerts).isAdminOnly)
        #expect(!NotificationDestination.profile.isAdminOnly)
    }

    @Test func tabContentDestinationsNameTheirHostTab() {
        #expect(NotificationDestination.inbox.hostTab == .activity)
        #expect(NotificationDestination.calendar(date: nil).hostTab == .activity)
        #expect(NotificationDestination.history.hostTab == .activity)
        #expect(NotificationDestination.findShelf(.watchlist).hostTab == .find)
        #expect(NotificationDestination.requests.hostTab == .activity)
        #expect(NotificationDestination.tab(.library).hostTab == .library)
        #expect(NotificationDestination.settings(.reencode).hostTab == nil)
        #expect(NotificationDestination.shelf(shelfId: 1).hostTab == nil)
    }

    @Test func tabHostedDestinationsNameTheirLane() {
        #expect(NotificationDestination.inbox.activityLane == .inbox)
        #expect(NotificationDestination.requests.activityLane == .requests)
        #expect(NotificationDestination.calendar(date: "2026-10-16").activityLane == .calendar)
        #expect(NotificationDestination.history.activityLane == .history)
        #expect(NotificationDestination.findShelf(.watchlist).activityLane == nil)
    }
}
