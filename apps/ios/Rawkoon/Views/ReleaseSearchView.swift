import RawkoonKit
import SwiftUI

/// Interactive indexer search sheet. Workflow and local filters have separate owners.
@MainActor
struct ReleaseSearchView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var session: ReleaseSearchSession
    @State private var filters: ReleaseSearchFilters
    let inputs: ReleaseSearchInputs
    let onGrabbed: (() -> Void)?

    init(
        query: String,
        libraryMediaId: Int?,
        tmdbId: Int?,
        mediaType: String,
        availableSeasons: [Int] = [],
        mediaYear: Int? = nil,
        originalTitle: String? = nil,
        originalLanguage: String? = nil,
        titleTranslations: [TitleTranslation] = [],
        targetSeason: Int? = nil,
        targetEpisode: Int? = nil,
        isUpgrade: Bool = false,
        onGrabbed: (() -> Void)? = nil
    ) {
        inputs = ReleaseSearchInputs(
            query: query, libraryMediaId: libraryMediaId, tmdbId: tmdbId,
            mediaType: mediaType, availableSeasons: availableSeasons,
            mediaYear: mediaYear, originalTitle: originalTitle,
            originalLanguage: originalLanguage, titleTranslations: titleTranslations,
            targetSeason: targetSeason, targetEpisode: targetEpisode, isUpgrade: isUpgrade
        )
        self.onGrabbed = onGrabbed
        _session = State(initialValue: ReleaseSearchSession(
            query: query, libraryMediaId: libraryMediaId, tmdbId: tmdbId,
            mediaType: mediaType, availableSeasons: availableSeasons,
            mediaYear: mediaYear, originalTitle: originalTitle,
            originalLanguage: originalLanguage, titleTranslations: titleTranslations,
            targetSeason: targetSeason, targetEpisode: targetEpisode, isUpgrade: isUpgrade
        ))
        _filters = State(initialValue: ReleaseSearchFilters(libraryMediaId: libraryMediaId))
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Theme.borderStrong)
                .frame(width: 40, height: 5)
                .padding(.top, 8)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Releases")
                        .font(.display(22))
                        .foregroundStyle(Theme.textStrong)
                    Text(session.searchQuery)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .lineLimit(1)
                    if let service = session.service, !service.isEmpty {
                        Text(service)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                #if targetEnvironment(macCatalyst)
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(Theme.muted)
                            .symbolRenderingMode(.hierarchical)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                #endif
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 10)

            ReleaseSearchControls(session: session, filters: filters)
            ReleaseSearchResults(session: session, filters: filters, onGrabbed: onGrabbed)
        }
        .background(Theme.base)
        .rawkoonMotion(RawkoonMotion.spring, value: motionState)
        .sensoryFeedback(RawkoonHaptics.feedback(for: .grab), trigger: session.grabbedGuids.count)
        .task {
            guard !model.isOffline else {
                session.isLoading = false
                return
            }
            await session.initialLoad(model: model)
        }
        .onChange(of: model.isOffline) { _, offline in
            guard !offline, session.releases.isEmpty, !session.isLoading else { return }
            Task { await session.initialLoad(model: model) }
        }
        .onChange(of: session.selectedSeason) { _, _ in
            Task { await session.search(model: model) }
        }
        .onChange(of: session.completeSeries) { _, isOn in
            if isOn {
                session.selectedSeason = nil
            }
            Task { await session.search(model: model) }
        }
        .onChange(of: inputs.signature) { _, _ in
            session.updateInputs(inputs)
        }
    }

    private enum ContentPhase: Equatable {
        case searching, offline, failed, empty, filteredOut, list
    }

    private var contentPhase: ContentPhase {
        if session.isLoading {
            return .searching
        }
        if model.isOffline, session.releases.isEmpty {
            return .offline
        }
        if session.errorMessage != nil, session.releases.isEmpty {
            return .failed
        }
        if session.releases.isEmpty {
            return .empty
        }
        return filters.filteredReleases(in: session).isEmpty ? .filteredOut : .list
    }

    private struct MotionState: Equatable {
        var content: ContentPhase
        var adminOnlyNote: String?
        var hasWarnings: Bool
        var refreshError: String?
        var grabError: String?
        var showsAiBanner: Bool
    }

    private var motionState: MotionState {
        MotionState(
            content: contentPhase,
            adminOnlyNote: session.adminOnlyNote,
            hasWarnings: !session.indexerWarnings.isEmpty,
            refreshError: session.releases.isEmpty ? nil : session.errorMessage,
            grabError: session.grabError,
            showsAiBanner: session.aiEnabled && !session.aiPickDismissed
        )
    }
}
