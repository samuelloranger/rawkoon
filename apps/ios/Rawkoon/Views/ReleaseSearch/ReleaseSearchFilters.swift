import Foundation
import Observation
import RawkoonKit
import SwiftUI

enum ReleaseSearchSort: String, CaseIterable, Identifiable {
    case quality, seeders, age, size, title

    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .quality: "Profile score"
        case .seeders: "Seeders"
        case .age: "Age"
        case .size: "Size"
        case .title: "Title"
        }
    }

    var sortKey: InteractiveSearchLogic.SortKey {
        switch self {
        case .quality: .quality
        case .seeders: .seeders
        case .age: .age
        case .size: .size
        case .title: .title
        }
    }
}

/// View-local filtering and ordering; none of these settings refetch the server.
@MainActor
@Observable
final class ReleaseSearchFilters {
    var filterQuery = ""
    var hideRejected = true
    var showPacksOnly = false
    var sortBy: ReleaseSearchSort
    var sortAscending = false
    var includedTrackers: Set<String> = []
    var excludedTrackers: Set<String> = []
    var includedLanguages: Set<String> = []

    init(libraryMediaId: Int?) {
        sortBy = libraryMediaId == nil ? .seeders : .quality
    }

    var hasActiveFilters: Bool {
        !includedTrackers.isEmpty || !excludedTrackers.isEmpty || !includedLanguages.isEmpty
    }

    func resetView() {
        hideRejected = false
        includedTrackers.removeAll()
        excludedTrackers.removeAll()
        includedLanguages.removeAll()
    }

    func sortOptions(for releases: [ReleaseItem]) -> [ReleaseSearchSort] {
        let hasQuality = releases.contains { $0.qualityScore != nil }
        return hasQuality ? ReleaseSearchSort.allCases : ReleaseSearchSort.allCases.filter { $0 != .quality }
    }

    func trackerOptions(for releases: [ReleaseItem]) -> [InteractiveSearchLogic.FilterOption] {
        InteractiveSearchLogic.trackerOptions(indexers: releases.map(\.indexer))
    }

    func languageOptions(for releases: [ReleaseItem]) -> [InteractiveSearchLogic.FilterOption] {
        InteractiveSearchLogic.languageOptions(languageLists: releases.map(\.languages))
    }

    func sortedReleases(in session: ReleaseSearchSession) -> [ReleaseItem] {
        let options = sortOptions(for: session.releases)
        let effectiveSort: ReleaseSearchSort = options.contains(sortBy) ? sortBy : .seeders
        return InteractiveSearchLogic.sortReleases(
            filteredReleases(in: session),
            by: effectiveSort.sortKey,
            dir: sortAscending ? .asc : .desc
        )
    }

    func filteredReleases(in session: ReleaseSearchSession) -> [ReleaseItem] {
        let expectedTitle = InteractiveSearchLogic.stripTitleSuffixes(session.searchQuery)
        let normalizedFilter = InteractiveSearchLogic.normalizeKey(filterQuery)
        return session.releases.filter { release in
            if hideRejected, isRejected(release, expectedTitle: expectedTitle, session: session) {
                return false
            }
            if showPacksOnly || session.selectedSeason != nil || session.completeSeries {
                if !(release.isSeasonPack == true || release.isCompleteSeries == true) {
                    return false
                }
            }
            let trackerKey = trackerKey(for: release)
            if !includedTrackers.isEmpty, !includedTrackers.contains(trackerKey) {
                return false
            }
            if excludedTrackers.contains(trackerKey) {
                return false
            }
            if languagesExcluded(for: release) {
                return false
            }
            if normalizedFilter.isEmpty {
                return true
            }
            let haystack = InteractiveSearchLogic.normalizeKey("\(release.title) \(release.indexer ?? "")")
            return haystack.contains(normalizedFilter)
        }
    }

    private func isRejected(
        _ release: ReleaseItem, expectedTitle: String, session: ReleaseSearchSession
    ) -> Bool {
        if release.rejected == true {
            return true
        }
        guard session.libraryMediaId == nil, !expectedTitle.isEmpty else { return false }
        return InteractiveSearchLogic.isClientRejected(
            releaseTitle: release.title, expectedTitle: expectedTitle,
            expectedYear: session.mediaYear
        )
    }

    private func languagesExcluded(for release: ReleaseItem) -> Bool {
        guard !includedLanguages.isEmpty else { return false }
        return languageKeys(for: release).isDisjoint(with: includedLanguages)
    }

    private func trackerKey(for release: ReleaseItem) -> String {
        let trimmed = release.indexer?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty
            ? InteractiveSearchLogic.unknownTrackerKey
            : InteractiveSearchLogic.normalizeKey(trimmed)
    }

    private func languageKeys(for release: ReleaseItem) -> Set<String> {
        if release.languages.isEmpty {
            return [InteractiveSearchLogic.unknownLanguageKey]
        }
        return Set(release.languages.map { InteractiveSearchLogic.normalizeKey($0) })
    }
}
