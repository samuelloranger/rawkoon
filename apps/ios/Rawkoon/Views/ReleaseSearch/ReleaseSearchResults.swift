import SwiftUI

struct ReleaseSearchResults: View {
    @Environment(AppModel.self) private var model
    let session: ReleaseSearchSession
    let filters: ReleaseSearchFilters
    let onGrabbed: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            notices
            ZStack { content }
        }
    }

    /// Notes that slide in above the results: admin-only, warnings, a failed refresh or grab, the AI pick.
    @ViewBuilder
    private var notices: some View {
        if let adminOnlyNote = session.adminOnlyNote {
            Text(adminOnlyNote)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.terracotta)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.rawkoonReveal)
        }

        if !session.indexerWarnings.isEmpty {
            warningStrip
                .transition(.rawkoonReveal)
        }

        // A failed refresh keeps the earlier results; say so above them.
        if let errorMessage = session.errorMessage, !session.releases.isEmpty {
            Text(errorMessage)
                .font(.subheadline)
                .foregroundStyle(Theme.terracotta)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.rawkoonReveal)
        }

        if let grabError = session.grabError {
            Text(grabError)
                .font(.subheadline)
                .foregroundStyle(Theme.terracotta)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.rawkoonReveal)
        }

        if session.aiEnabled, !session.aiPickDismissed {
            AiPickBanner(
                aiPickLoading: session.aiPickLoading,
                aiPickError: session.aiPickError,
                aiPickBudgetReached: session.aiPickBudgetReached,
                aiPickedRelease: session.aiPickedRelease,
                aiPickGrabbed: session.aiPickGrabbed,
                aiPick: session.aiPick,
                grabbingGuid: session.grabbingGuid,
                onRetry: { await session.runAiPick(model: model, force: true) },
                onGrab: { release in await session.grabFromBanner(release, model: model, onGrabbed: onGrabbed) },
                onDismiss: { session.aiPickDismissed = true }
            )
            .transition(.rawkoonReveal)
        }
    }

    private var warningStrip: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(session.indexerWarnings) { warning in
                Text("\(warning.name): \(warning.error)")
                    .font(.caption2)
                    .foregroundStyle(Theme.terracotta)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var content: some View {
        if session.isLoading {
            VStack(spacing: 10) {
                ProgressView().tint(Theme.apricot)
                Text("Searching…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else if model.isOffline, session.releases.isEmpty {
            ContentUnavailableView {
                Label("Offline", systemImage: "wifi.slash")
            } description: {
                Text("Release search needs a connection.")
            }
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else if let errorMessage = session.errorMessage, session.releases.isEmpty {
            ContentUnavailableView {
                Label("Search failed", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            }
            .rawkoonLivingSymbol(.error)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else if session.releases.isEmpty {
            ContentUnavailableView.search
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)
        } else if filters.filteredReleases(in: session).isEmpty {
            // Results came back but the active filters (commonly "Hide rejected")
            // hide them all — say so and offer a reset, mirroring the web
            // "No matches" + Reset view empty state instead of a blank sheet.
            ContentUnavailableView {
                Label("No matches", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("\(session.releases.count) results are hidden by your filters.")
            } actions: {
                Button("Reset view") { filters.resetView() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.terracotta)
            }
            .rawkoonLivingSymbol(.empty)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.rawkoonSwap)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(filters.sortedReleases(in: session)) { release in
                        ReleaseRow(
                            release: release,
                            isGrabbing: session.grabbingGuid == release.guid,
                            isGrabbed: session.grabbedGuids.contains(release.guid),
                            alreadyGrabbed: session.isAlreadyGrabbed(release),
                            isBlocking: session.blockingGuid == release.guid,
                            isBlocked: session.blockedGuids.contains(release.guid),
                            isAiPick: release.guid == session.aiPickBadgeKey,
                            onGrab: { await session.grab(release, model: model, onGrabbed: onGrabbed) },
                            onBlock: { await session.block(release, model: model) }
                        )
                        .rawkoonEntrance(id: release.guid)
                    }
                }
                .padding(16)
                .rawkoonEntranceScope()
            }
            .transition(.rawkoonSwap)
        }
    }
}
