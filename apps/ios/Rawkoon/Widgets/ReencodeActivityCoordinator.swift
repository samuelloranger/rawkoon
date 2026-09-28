import Foundation
#if !targetEnvironment(macCatalyst)
    import ActivityKit

    /// Registers ActivityKit tokens with the user's own Rawkoon server. The
    /// server/relay can then start and update an admin re-encode while the app is closed.
    @MainActor
    final class ReencodeActivityCoordinator {
        static let shared = ReencodeActivityCoordinator()
        private var startTokenTask: Task<Void, Never>?
        private var activityTask: Task<Void, Never>?
        private var tokenTasks: [String: Task<Void, Never>] = [:]

        private init() {}

        func start(model: AppModel) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            registerCurrentToken(model: model)
            if startTokenTask == nil {
                startTokenTask = Task { @MainActor in
                    for await token in Activity<ReencodeActivityAttributes>.pushToStartTokenUpdates {
                        guard !Task.isCancelled else { return }
                        await registerStartToken(token, model: model)
                    }
                }
            }
            for activity in Activity<ReencodeActivityAttributes>.activities {
                observe(activity, model: model)
            }
            if activityTask == nil {
                activityTask = Task { @MainActor in
                    for await activity in Activity<ReencodeActivityAttributes>.activityUpdates {
                        guard !Task.isCancelled else { return }
                        observe(activity, model: model)
                    }
                }
            }
        }

        func registerCurrentToken(model: AppModel) {
            guard model.isLoggedIn, model.isAdmin,
                  let token = Activity<ReencodeActivityAttributes>.pushToStartToken
            else { return }
            Task { await registerStartToken(token, model: model) }
        }

        func stop(model: AppModel) {
            startTokenTask?.cancel()
            activityTask?.cancel()
            tokenTasks.values.forEach { $0.cancel() }
            startTokenTask = nil
            activityTask = nil
            tokenTasks = [:]
            if let client = model.api(), model.isAdmin {
                let installationId = model.deviceID
                Task { try? await client.unregisterReencodePushToStart(installationId: installationId) }
            }
        }

        private func registerStartToken(_ token: Data, model: AppModel) async {
            guard model.isLoggedIn, model.isAdmin, let client = model.api() else { return }
            try? await client.registerReencodePushToStart(
                installationId: model.deviceID,
                token: token.map { String(format: "%02x", $0) }.joined()
            )
        }

        private func observe(_ activity: Activity<ReencodeActivityAttributes>, model: AppModel) {
            guard tokenTasks[activity.id] == nil,
                  activity.activityState == .active || activity.activityState == .stale
            else { return }
            tokenTasks[activity.id] = Task { @MainActor in
                if let token = activity.pushToken {
                    await registerActivityToken(token, activity: activity, model: model)
                }
                for await token in activity.pushTokenUpdates {
                    guard !Task.isCancelled else { return }
                    await registerActivityToken(token, activity: activity, model: model)
                }
                tokenTasks[activity.id] = nil
            }
        }

        private func registerActivityToken(
            _ token: Data,
            activity: Activity<ReencodeActivityAttributes>,
            model: AppModel
        ) async {
            guard model.isLoggedIn, model.isAdmin, let client = model.api() else { return }
            do {
                try await client.registerReencodeActivityToken(
                    installationId: model.deviceID,
                    jobId: activity.attributes.jobId,
                    token: token.map { String(format: "%02x", $0) }.joined()
                )
            } catch let error as APIError where error.isStaleActivity {
                // The server already finished this job, so no push will ever end this activity.
                await ReencodeActivityHandle(value: activity).end()
            } catch {}
        }
    }

    /// ActivityKit's Activity is safe across its async methods but the SDK doesn't mark it Sendable.
    private nonisolated struct ReencodeActivityHandle: @unchecked Sendable {
        let value: Activity<ReencodeActivityAttributes>

        func end() async {
            await value.end(nil, dismissalPolicy: .immediate)
        }
    }

    private extension APIError {
        /// The server answers 409 when the activity's job is no longer current for this device.
        var isStaleActivity: Bool {
            switch self {
            case .server(status: 409, _), .http(409): true
            default: false
            }
        }
    }
#else
    @MainActor
    final class ReencodeActivityCoordinator {
        static let shared = ReencodeActivityCoordinator()
        func start(model _: AppModel) {}
        func stop(model _: AppModel) {}
    }
#endif
