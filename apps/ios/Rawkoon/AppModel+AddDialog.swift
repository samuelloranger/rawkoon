import Foundation
import RawkoonKit

/// What the add sheet is about: a title or a book, whichever screen it came from.
struct AddSubject: Sendable {
    let kind: AddDialogPolicy.Subject
    let title: String
    let year: Int?
    let imageUrl: String?
    let tmdbId: Int?
    /// A book's author line.
    let byline: String?

    init(_ pick: TitlePick) {
        kind = pick.mediaType == "tv" ? .show : .movie
        title = pick.title
        year = pick.year
        imageUrl = pick.posterUrl
        tmdbId = pick.tmdbId
        byline = nil
    }

    init(bookTitle: String, author: String?, year: Int?, coverUrl: String?) {
        kind = .book
        title = bookTitle
        self.year = year
        imageUrl = coverUrl
        tmdbId = nil
        byline = author
    }
}

/// The sheet's answer; nil fields keep the server defaults.
struct AddChoice: Sendable {
    var qualityProfileId: Int?
    var season: SeasonChoice?
    var searchOnAdd: Bool?
    var bookKinds: [String]?
    var bookProfileId: Int?
}

struct AddProfileOption: Identifiable, Sendable, Equatable {
    let id: Int
    let name: String
    let detail: String?
    /// Books only: ebook, audiobook or both.
    let kind: String?
}

/// Server defaults that prefill the sheet.
struct AddDefaults: Sendable {
    var profileId: Int?
    var seasonMode: SeasonMode = .all
    var monitorNew = true
    var searchOnAdd = true
    /// Seeds the strip in Pick mode (screenshot harness).
    var picked: Set<Int> = []
}

/// One open add sheet. The caller awaits `AppModel.chooseAdd`; the sheet answers once.
@MainActor
final class AddSheetRequest: Identifiable {
    let id = UUID()
    let subject: AddSubject
    let isAdmin: Bool
    let compact: Bool
    let profiles: [AddProfileOption]
    let seasons: [SeasonInfo]
    let defaults: AddDefaults
    private var continuation: CheckedContinuation<AddChoice?, Never>?

    init(
        subject: AddSubject, isAdmin: Bool, compact: Bool, profiles: [AddProfileOption],
        seasons: [SeasonInfo], defaults: AddDefaults, continuation: CheckedContinuation<AddChoice?, Never>?
    ) {
        self.subject = subject
        self.isAdmin = isAdmin
        self.compact = compact
        self.profiles = profiles
        self.seasons = seasons
        self.defaults = defaults
        self.continuation = continuation
    }

    /// First answer wins; a swipe-down dismissal answers nil after a confirm already did.
    func finish(_ choice: AddChoice?) {
        continuation?.resume(returning: choice)
        continuation = nil
    }
}

extension AppModel {
    /// Asks the user how to add `subject`. Returns nil when the sheet is not needed (the caller adds
    /// with server defaults, as before) and throws `CancellationError` when the user backs out.
    func chooseAdd(_ subject: AddSubject, compact: Bool = false) async throws -> AddChoice? {
        guard let client = api() else { throw URLError(.notConnectedToInternet) }
        guard askBeforeAdding else { return nil }
        let kind = subject.kind
        // Cheap exits before any fetch: a requester only ever sees the sheet for a show.
        if !isAdmin, !(kind == .show && requestersChooseSeasons) {
            return nil
        }

        var profiles: [AddProfileOption] = []
        var defaults = AddDefaults()
        if isAdmin {
            guard let loaded = await Self.loadProfiles(client, kind: kind) else { return nil }
            profiles = loaded
            if let settings = try? await client.postProcessingSettings().settings {
                defaults = Self.defaults(from: settings, kind: kind)
            }
            if defaults.profileId == nil || !profiles.contains(where: { $0.id == defaults.profileId }) {
                defaults.profileId = profiles.first?.id
            }
        }
        guard AddDialogPolicy.needsDialog(
            kind, isAdmin: isAdmin, askBeforeAdding: askBeforeAdding,
            requestersChooseSeasons: requestersChooseSeasons, movieProfileCount: profiles.count
        ) else { return nil }

        let seasons = kind == .show ? await Self.loadSeasons(client, tmdbId: subject.tmdbId) : []
        // A show whose seasons could not be read still adds, with the server defaults.
        if kind == .show, seasons.isEmpty, !isAdmin {
            return nil
        }

        router.addRequest?.finish(nil)
        let admin = isAdmin
        let answer = await withCheckedContinuation { (continuation: CheckedContinuation<AddChoice?, Never>) in
            router.addRequest = AddSheetRequest(
                subject: subject, isAdmin: admin, compact: compact, profiles: profiles,
                seasons: seasons, defaults: defaults, continuation: continuation
            )
        }
        router.addRequest = nil
        guard let answer else { throw CancellationError() }
        return answer
    }

    /// A show's regular seasons from TMDB; empty when they could not be read.
    static func loadSeasons(_ client: APIClient, tmdbId: Int?) async -> [SeasonInfo] {
        guard let tmdbId, let modal = try? await client.mediaModal(mediaType: "tv", tmdbId: tmdbId) else { return [] }
        return SeasonPlan.regular((modal.details.seasons ?? []).map {
            SeasonInfo(number: $0.seasonNumber, episodes: $0.episodeCount ?? 0, airDate: $0.airDate)
        })
    }

    private static func defaults(from settings: PostProcessingSettingsDTO, kind: AddDialogPolicy.Subject) -> AddDefaults {
        var defaults = AddDefaults()
        defaults.seasonMode = SeasonMode(rawValue: settings.defaultSeasonMode ?? "") ?? .all
        defaults.monitorNew = settings.defaultMonitorNewSeasons ?? true
        defaults.searchOnAdd = settings.searchOnAdd ?? true
        defaults.profileId = switch kind {
        case .movie: settings.defaultMovieQualityProfileId
        case .show: settings.defaultShowQualityProfileId
        case .book: settings.defaultBookQualityProfileId
        }
        return defaults
    }

    /// nil when the profiles could not be read, which falls back to the instant add.
    private static func loadProfiles(_ client: APIClient, kind: AddDialogPolicy.Subject) async -> [AddProfileOption]? {
        do {
            if kind == .book {
                return try await client.bookQualityProfiles().profiles.map {
                    AddProfileOption(id: $0.id, name: $0.name, detail: $0.cutoffFormat?.uppercased(), kind: $0.kind)
                }
            }
            return try await client.qualityProfiles().profiles.map { profile in
                let detail = profile.cutoffResolution.map { String(localized: "Up to \($0)p") }
                return AddProfileOption(id: profile.id, name: profile.name, detail: detail, kind: nil)
            }
        } catch {
            return nil
        }
    }
}
