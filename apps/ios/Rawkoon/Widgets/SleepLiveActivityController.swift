import Foundation
#if !targetEnvironment(macCatalyst)
    import ActivityKit

    /// ActivityKit publishes Activity references for asynchronous updates but the
    /// Xcode 27 SDK has not annotated the reference as Sendable yet.
    extension Activity: @unchecked Sendable {}

    /// The countdown is owned by playback, not by PlayerView: remote commands and
    /// background audio can pause or finish it after the sheet disappears.
    @MainActor
    final class SleepLiveActivityController {
        /// ActivityKit's Activity reference is safe to use across its async update
        /// methods but is not annotated Sendable in the SDK.
        private struct ActivityHandle: @unchecked Sendable {
            let value: Activity<SleepActivityAttributes>

            func update(_ content: ActivityContent<SleepActivityAttributes.ContentState>) async {
                await value.update(content)
            }

            func end() async {
                await value.end(nil, dismissalPolicy: .immediate)
            }
        }

        private var activity: ActivityHandle?

        init() {
            // A process restart cannot restore a running audiobook sleep timer.
            Task {
                for existing in Activity<SleepActivityAttributes>.activities {
                    await existing.end(nil, dismissalPolicy: .immediate)
                }
            }
        }

        func sync(bookTitle: String?, chapterTitle: String?, remaining: Double?, isPlaying: Bool) {
            guard let remaining, remaining > 0, let bookTitle,
                  ActivityAuthorizationInfo().areActivitiesEnabled
            else {
                end()
                return
            }

            let state = SleepActivityAttributes.ContentState(
                remainingSeconds: remaining,
                measuredAt: Date(),
                isPlaying: isPlaying,
                chapterTitle: chapterTitle
            )
            let content = ActivityContent(state: state, staleDate: nil)
            if let activity {
                Task { await activity.update(content) }
            } else {
                do {
                    activity = try ActivityHandle(value: Activity.request(
                        attributes: SleepActivityAttributes(bookTitle: bookTitle),
                        content: content,
                        pushType: nil
                    ))
                } catch {
                    // ActivityKit can be disabled per app or unavailable on a device.
                }
            }
        }

        func end() {
            guard let activity else { return }
            self.activity = nil
            Task { await activity.end() }
        }
    }
#else
    @MainActor
    final class SleepLiveActivityController {
        func sync(bookTitle _: String?, chapterTitle _: String?, remaining _: Double?, isPlaying _: Bool) {}
        func end() {}
    }
#endif
