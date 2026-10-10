import SwiftUI
import UIKit

/// Maps app events to system haptics so feedback is consistent everywhere.
enum RawkoonHaptics {
    enum Event {
        case playPause, chapterSkip, grab, downloadComplete, libraryChanged
        case success, error, warning
        case deckDismiss, deckCommit
    }

    /// The UIKit generator call for code paths with no view to hang `.sensoryFeedback` on.
    nonisolated enum Imperative: Equatable {
        case notification(UINotificationFeedbackGenerator.FeedbackType)
        case selection
        case impact(UIImpactFeedbackGenerator.FeedbackStyle)
    }

    nonisolated static func feedback(for event: Event) -> SensoryFeedback {
        switch event {
        case .playPause: .selection
        case .chapterSkip: .impact(weight: .light)
        case .grab, .downloadComplete, .libraryChanged, .success: .success
        case .error: .error
        case .warning: .warning
        case .deckDismiss: .impact(flexibility: .rigid)
        case .deckCommit: .impact(weight: .medium)
        }
    }

    nonisolated static func imperative(for event: Event) -> Imperative {
        switch event {
        case .playPause: .selection
        case .chapterSkip: .impact(.light)
        case .grab, .downloadComplete, .libraryChanged, .success: .notification(.success)
        case .error: .notification(.error)
        case .warning: .notification(.warning)
        case .deckDismiss: .impact(.rigid)
        case .deckCommit: .impact(.medium)
        }
    }

    static func play(_ event: Event) {
        switch imperative(for: event) {
        case let .notification(type): UINotificationFeedbackGenerator().notificationOccurred(type)
        case .selection: UISelectionFeedbackGenerator().selectionChanged()
        case let .impact(style): UIImpactFeedbackGenerator(style: style).impactOccurred()
        }
    }
}
