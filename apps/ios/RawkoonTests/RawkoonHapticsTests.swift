@testable import Rawkoon
import SwiftUI
import Testing
import UIKit

struct RawkoonHapticsTests {
    @Test func eventsMapToExpectedFeedback() {
        #expect(RawkoonHaptics.feedback(for: .playPause) == .selection)
        #expect(RawkoonHaptics.feedback(for: .chapterSkip) == .impact(weight: .light))
        #expect(RawkoonHaptics.feedback(for: .grab) == .success)
        #expect(RawkoonHaptics.feedback(for: .downloadComplete) == .success)
        #expect(RawkoonHaptics.feedback(for: .libraryChanged) == .success)
        #expect(RawkoonHaptics.feedback(for: .success) == .success)
        #expect(RawkoonHaptics.feedback(for: .error) == .error)
        #expect(RawkoonHaptics.feedback(for: .warning) == .warning)
        #expect(RawkoonHaptics.feedback(for: .deckDismiss) == .impact(flexibility: .rigid))
        #expect(RawkoonHaptics.feedback(for: .deckCommit) == .impact(weight: .medium))
        #expect(RawkoonHaptics.feedback(for: .tap) == .selection)
    }

    @Test func imperativeMatchesSensoryFeedback() {
        #expect(RawkoonHaptics.imperative(for: .playPause) == .selection)
        #expect(RawkoonHaptics.imperative(for: .chapterSkip) == .impact(.light))
        #expect(RawkoonHaptics.imperative(for: .grab) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .downloadComplete) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .libraryChanged) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .success) == .notification(.success))
        #expect(RawkoonHaptics.imperative(for: .error) == .notification(.error))
        #expect(RawkoonHaptics.imperative(for: .warning) == .notification(.warning))
        #expect(RawkoonHaptics.imperative(for: .deckDismiss) == .impact(.rigid))
        #expect(RawkoonHaptics.imperative(for: .deckCommit) == .impact(.medium))
        #expect(RawkoonHaptics.imperative(for: .tap) == .selection)
    }
}
