@testable import Rawkoon
import SwiftUI
import Testing

struct RawkoonHapticsTests {
    @Test func eventsMapToExpectedFeedback() {
        #expect(RawkoonHaptics.feedback(for: .playPause) == .selection)
        #expect(RawkoonHaptics.feedback(for: .chapterSkip) == .impact(weight: .light))
        #expect(RawkoonHaptics.feedback(for: .grab) == .success)
        #expect(RawkoonHaptics.feedback(for: .downloadComplete) == .success)
        #expect(RawkoonHaptics.feedback(for: .libraryChanged) == .success)
    }
}
