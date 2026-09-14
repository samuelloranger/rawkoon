import SwiftUI

/// Maps app events to system haptics so feedback is consistent everywhere.
enum RawkoonHaptics {
    enum Event { case playPause, chapterSkip, grab, downloadComplete }

    nonisolated static func feedback(for event: Event) -> SensoryFeedback {
        switch event {
        case .playPause: .selection
        case .chapterSkip: .impact(weight: .light)
        case .grab, .downloadComplete: .success
        }
    }
}
