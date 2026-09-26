@testable import Rawkoon
import Testing

@MainActor
struct NotificationDestinationTests {
    @Test func settingsTranscodeTabRoutesToReencode() {
        #expect(NotificationDestination.resolve(url: "/settings?tab=transcode") == .transcode)
    }

    @Test func otherSettingsTabsStayUnrouted() {
        #expect(NotificationDestination.resolve(url: "/settings?tab=users") == nil)
        #expect(NotificationDestination.resolve(url: "/settings") == nil)
    }

    @Test func existingRoutesUnchanged() {
        #expect(NotificationDestination.resolve(url: "/requests") == .requests)
    }
}
