import Foundation
import Observation
import RawkoonKit

/// Values supplied by the presenting view; these can update while its sheet is open.
struct ReleaseSearchInputs {
    let query: String
    let libraryMediaId: Int?
    let tmdbId: Int?
    let mediaType: String
    let availableSeasons: [Int]
    let mediaYear: Int?
    let originalTitle: String?
    let originalLanguage: String?
    let titleTranslations: [TitleTranslation]
    let targetSeason: Int?
    let targetEpisode: Int?
    let isUpgrade: Bool

    var signature: [String] {
        var values = [query]
        values.append(String(describing: libraryMediaId))
        values.append(String(describing: tmdbId))
        values.append(mediaType)
        values.append(availableSeasons.map(String.init).joined(separator: ","))
        values.append(String(describing: mediaYear))
        values.append(String(describing: originalTitle))
        values.append(String(describing: originalLanguage))
        values.append(String(describing: targetSeason))
        values.append(String(describing: targetEpisode))
        values.append(String(isUpgrade))
        values.append(contentsOf: titleTranslations.flatMap { [$0.languageCode, $0.title] })
        return values
    }
}

/// One sheet's server-backed search, AI suggestion, and release actions.
@MainActor
@Observable
final class ReleaseSearchSession {
    var libraryMediaId: Int?
    var tmdbId: Int?
    var mediaType: String
    var availableSeasons: [Int]
    var mediaYear: Int?
    var localizedTitle: String
    var originalTitle: String?
    var originalLanguage: String?
    var titleTranslations: [TitleTranslation]
    var targetSeason: Int?
    var targetEpisode: Int?
    var isUpgrade: Bool

    var searchQuery: String
    var selectedSeason: Int?
    var completeSeries = false
    var releases: [ReleaseItem] = []
    var service: String?
    var indexerWarnings: [IndexerWarning] = []
    var isLoading = true
    var errorMessage: String?
    var grabError: String?
    var adminOnlyNote: String?
    var grabbingGuid: String?
    var grabbedGuids: Set<String> = []
    var grabbedTitles: Set<String> = []
    var blockingGuid: String?
    var blockedGuids: Set<String> = []

    var aiEnabled = false
    var aiPickLoading = false
    var aiPick: AiPick?
    var aiPickError: String?
    var aiPickBudgetReached = false
    var aiPickGrabbed = false
    var aiPickDismissed = false
    private var releasesKey: String?
    private var lastAiPickKey: String?
    private var inFlightAiPickKey: String?
    private var aiPickGeneration = 0

    init(
        query: String, libraryMediaId: Int?, tmdbId: Int?, mediaType: String,
        availableSeasons: [Int], mediaYear: Int?, originalTitle: String?,
        originalLanguage: String?, titleTranslations: [TitleTranslation],
        targetSeason: Int?, targetEpisode: Int?, isUpgrade: Bool
    ) {
        searchQuery = query
        localizedTitle = query
        self.libraryMediaId = libraryMediaId
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.availableSeasons = availableSeasons.filter { $0 > 0 }.sorted()
        self.mediaYear = mediaYear
        self.originalTitle = originalTitle
        self.originalLanguage = originalLanguage
        self.titleTranslations = titleTranslations
        self.targetSeason = targetSeason
        self.targetEpisode = targetEpisode
        self.isUpgrade = isUpgrade
        selectedSeason = targetEpisode == nil ? targetSeason : nil
    }

    /// Parent-provided details can arrive after the sheet opens. Preserve the
    /// user's query, season selection and sort while updating those details.
    func updateInputs(_ inputs: ReleaseSearchInputs) {
        localizedTitle = inputs.query
        libraryMediaId = inputs.libraryMediaId
        tmdbId = inputs.tmdbId
        mediaType = inputs.mediaType
        availableSeasons = inputs.availableSeasons.filter { $0 > 0 }.sorted()
        mediaYear = inputs.mediaYear
        originalTitle = inputs.originalTitle
        originalLanguage = inputs.originalLanguage
        titleTranslations = inputs.titleTranslations
        targetSeason = inputs.targetSeason
        targetEpisode = inputs.targetEpisode
        isUpgrade = inputs.isUpgrade
    }

    var titleOptions: [InteractiveSearchLogic.TitleOption] {
        InteractiveSearchLogic.buildTitleOptions(
            localized: localizedTitle, localizedLanguage: "en",
            original: originalTitle, originalLanguage: originalLanguage,
            translations: titleTranslations.map {
                .init(languageCode: $0.languageCode, title: $0.title)
            }
        )
    }

    var aiPickedRelease: ReleaseItem? {
        guard let key = aiPick?.releaseKey else { return nil }
        return releases.first { $0.guid == key }
    }

    var aiPickBadgeKey: String? {
        guard aiEnabled, !aiPickDismissed else { return nil }
        return aiPick?.releaseKey
    }

    private var aiTarget: (season: Int?, episode: Int?) {
        let matchesSelection = selectedSeason == nil || selectedSeason == targetSeason
        if let targetSeason, let targetEpisode, !completeSeries, matchesSelection {
            return (targetSeason, targetEpisode)
        }
        return (completeSeries ? nil : selectedSeason, nil)
    }

    func initialLoad(model: AppModel) async {
        isLoading = true
        await resolveAiGate(model: model)
        await loadGrabbedTitles(model: model)
        await search(model: model)
    }

    func search(model: AppModel) async {
        guard let client = model.api() else {
            errorMessage = String(localized: "Not connected.")
            isLoading = false
            return
        }
        guard !model.isOffline else {
            isLoading = false
            return
        }
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedQuery.count < 2, selectedSeason == nil, !completeSeries {
            errorMessage = String(localized: "Search query must be at least 2 characters.")
            releases = []
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil
        grabError = nil
        adminOnlyNote = nil
        indexerWarnings = []
        defer { isLoading = false }
        let searchKey = "\(trimmedQuery)|\(selectedSeason.map(String.init) ?? "")|\(completeSeries)"
        if searchKey != releasesKey {
            releases = []
        }
        do {
            let response = try await client.interactiveSearch(
                q: trimmedQuery, libraryMediaId: libraryMediaId,
                season: completeSeries ? nil : selectedSeason,
                complete: completeSeries, tmdbId: tmdbId, mediaType: mediaType
            )
            releases = response.releases
            releasesKey = searchKey
            service = response.service
            indexerWarnings = response.indexerWarnings ?? []
        } catch APIError.unauthorized {
            adminOnlyNote = String(localized: "Admin only")
            releases = []
        } catch {
            errorMessage = String(localized: "Couldn't load releases. Check the server.")
        }
        Task { await runAiPick(model: model) }
    }

    private func resolveAiGate(model: AppModel) async {
        guard let client = model.api() else { return }
        aiEnabled = await client.aiInteractivePickEnabled()
        if aiEnabled {
            Task { await client.aiWarm() }
        }
    }

    func runAiPick(model: AppModel, force: Bool = false) async {
        guard aiEnabled, let client = model.api() else { return }
        let candidates = releases.filter { $0.rejected != true }
        guard !candidates.isEmpty else {
            aiPick = nil
            aiPickError = nil
            aiPickBudgetReached = false
            aiPickLoading = false
            lastAiPickKey = nil
            inFlightAiPickKey = nil
            aiPickGeneration += 1
            return
        }
        let target = aiTarget
        let seasonKey = target.season.map(String.init) ?? ""
        let episodeKey = target.episode.map(String.init) ?? ""
        let targetKey = "\(completeSeries)|\(seasonKey)|\(episodeKey)"
        let key = candidates.map(\.guid).sorted().joined(separator: ",") + "|" + targetKey
        if !force, key == lastAiPickKey || key == inFlightAiPickKey {
            return
        }
        aiPickGeneration += 1
        let generation = aiPickGeneration
        inFlightAiPickKey = key
        lastAiPickKey = nil
        aiPickDismissed = false
        aiPickGrabbed = false
        aiPickError = nil
        aiPickBudgetReached = false
        aiPick = nil
        aiPickLoading = true
        let request = AiPickRequest(
            mediaContext: AiPickMediaContext(
                title: searchQuery, year: mediaYear, type: mediaType,
                season: target.season, episode: target.episode
            ),
            releases: candidates.map { release in
                AiPickCandidate(
                    key: release.guid, title: release.title, sizeBytes: release.sizeBytes,
                    seeders: release.seeders, score: release.qualityScore
                )
            },
            mediaId: libraryMediaId
        )
        do {
            let result = try await client.aiPick(request)
            guard generation == aiPickGeneration else { return }
            if !Task.isCancelled {
                aiPick = result
                lastAiPickKey = key
            }
        } catch {
            guard generation == aiPickGeneration else { return }
            if !Task.isCancelled {
                handleAiPickFailure(error)
            }
        }
        inFlightAiPickKey = nil
        aiPickLoading = false
    }

    private func handleAiPickFailure(_ error: Error) {
        var status: Int?
        switch error as? APIError {
        case let .http(code): status = code
        case let .server(code, _): status = code
        default: break
        }
        switch AiPickFailure.from(status: status) {
        case .featureOff: aiEnabled = false
        case .budgetReached: aiPickBudgetReached = true
        case .failed: aiPickError = String(localized: "Could not get a response from AI")
        }
    }

    func isAlreadyGrabbed(_ release: ReleaseItem) -> Bool {
        grabbedTitles.contains(normalizedTitle(release.title)) || grabbedGuids.contains(release.guid)
    }

    private func normalizedTitle(_ title: String) -> String {
        title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func loadGrabbedTitles(model: AppModel) async {
        guard let client = model.api(), let libraryMediaId else { return }
        guard let response = try? await client.downloads(libraryId: libraryMediaId) else { return }
        grabbedTitles = Set(response.items.map { normalizedTitle($0.releaseTitle) })
    }

    func block(_ release: ReleaseItem, model: AppModel) async {
        guard let client = model.api() else { return }
        blockingGuid = release.guid
        defer { blockingGuid = nil }
        do {
            try await client.blockRelease(BlocklistBody(
                releaseTitle: release.title, indexer: release.indexer,
                mediaId: libraryMediaId, episodeId: nil
            ))
            blockedGuids.insert(release.guid)
            grabError = nil
        } catch APIError.unauthorized {
            adminOnlyNote = String(localized: "Admin only")
        } catch {
            grabError = String(localized: "Block failed for \"\(release.title)\".")
        }
    }

    func grab(_ release: ReleaseItem, model: AppModel, onGrabbed: (() -> Void)?) async {
        guard let client = model.api() else { return }
        grabbingGuid = release.guid
        defer { grabbingGuid = nil }
        do {
            if let libraryMediaId, let downloadUrl = release.downloadUrl {
                let result = try await client.grabByUrl(
                    libraryId: libraryMediaId,
                    body: GrabUrlBody(
                        downloadUrl: downloadUrl, releaseTitle: release.title, episodeId: nil,
                        season: completeSeries ? nil : selectedSeason, indexer: release.indexer,
                        qualityParsed: release.parsedQuality, sizeBytes: release.sizeBytes,
                        isUpgrade: isUpgrade ? true : nil
                    )
                )
                if !result.grabbed {
                    grabError = result.reason ?? String(localized: "Grab failed for \"\(release.title)\".")
                    return
                }
            } else if let token = release.downloadToken {
                let result = try await client.grabByToken(token)
                if !result.grabbed {
                    grabError = result.reason ?? String(localized: "Grab failed for \"\(release.title)\".")
                    return
                }
            } else {
                grabError = String(localized: "This release can't be grabbed.")
                return
            }
            grabbedGuids.insert(release.guid)
            grabError = nil
            onGrabbed?()
            await loadGrabbedTitles(model: model)
        } catch APIError.unauthorized {
            adminOnlyNote = String(localized: "Admin only")
        } catch {
            grabError = String(localized: "Grab failed for \"\(release.title)\".")
        }
    }

    func grabFromBanner(_ release: ReleaseItem, model: AppModel, onGrabbed: (() -> Void)?) async {
        await grab(release, model: model, onGrabbed: onGrabbed)
        guard grabbedGuids.contains(release.guid) else { return }
        aiPickGrabbed = true
        try? await Task.sleep(for: .milliseconds(1800))
        aiPickDismissed = true
    }
}
