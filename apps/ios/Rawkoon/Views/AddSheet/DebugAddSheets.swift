#if DEBUG
    // motion-ok-file: debug-only harness
    import RawkoonKit
    import SwiftUI

    /// `RAWKOON_SCREEN=addShow|addShowPick|addMovie|addBook|requestShow|approveShow|manageSeasons`:
    /// the add-flow sheets over synthetic data, so they can be screenshotted with no server.
    struct DebugAddSheets: View {
        let screen: String

        private static let seasons = [
            SeasonInfo(number: 1, episodes: 6, airDate: "2022-04-01"),
            SeasonInfo(number: 2, episodes: 6, airDate: "2023-12-01"),
            SeasonInfo(number: 3, episodes: 6, airDate: "2024-09-01"),
            SeasonInfo(number: 4, episodes: 6, airDate: "2024-09-01"),
            SeasonInfo(number: 5, episodes: 6, airDate: "2025-09-01"),
            SeasonInfo(number: 6, episodes: 0, airDate: nil),
        ]

        private static let profiles = [
            AddProfileOption(id: 1, name: "1080p - VFQ", detail: nil, kind: nil),
            AddProfileOption(id: 2, name: "2160p - HDR", detail: nil, kind: nil),
        ]

        private static let bookProfiles = [
            AddProfileOption(id: 1, name: "Books - EPUB", detail: nil, kind: "ebook"),
            AddProfileOption(id: 2, name: "Books - EPUB + M4B", detail: nil, kind: "both"),
        ]

        private var show: AddSubject {
            AddSubject(TitlePick(
                tmdbId: 1, mediaType: "tv", title: "Slow Horses", year: 2022, posterUrl: nil, overview: nil
            ))
        }

        private func request(_ subject: AddSubject, admin: Bool, mode: SeasonMode = .all, picked: Set<Int> = [], compact: Bool = false) -> AddSheetRequest {
            AddSheetRequest(
                subject: subject, isAdmin: admin, compact: compact,
                profiles: subject.kind == .book ? Self.bookProfiles : Self.profiles,
                seasons: subject.kind == .show ? Self.seasons : [],
                defaults: AddDefaults(profileId: 1, seasonMode: mode, picked: picked),
                continuation: nil
            )
        }

        var body: some View {
            Theme.base.ignoresSafeArea().sheet(isPresented: .constant(true)) { content }
        }

        @ViewBuilder
        private var content: some View {
            switch screen {
            case "addShowPick":
                AddTitleSheet(request: request(show, admin: true, mode: .pick, picked: [1, 2, 5]))
            case "addCompact":
                AddTitleSheet(request: request(show, admin: true, compact: true))
            case "addMovie":
                AddTitleSheet(request: request(
                    AddSubject(TitlePick(tmdbId: 2, mediaType: "movie", title: "Dune: Part Two", year: 2024, posterUrl: nil, overview: nil)),
                    admin: true
                ))
            case "addBook":
                AddTitleSheet(request: request(
                    AddSubject(bookTitle: "Project Hail Mary", author: "Andy Weir", year: 2021, coverUrl: nil), admin: true
                ))
            case "requestShow":
                AddTitleSheet(request: request(show, admin: false, mode: .future))
            case "approveShow":
                ProfilePickerSheet(
                    options: Self.profiles.map { ApprovalProfileOption(id: $0.id, name: $0.name, detail: "up to 1080p") },
                    seasons: Self.seasons,
                    requested: SeasonDraft(mode: .pick, picked: [5], monitorNew: true)
                ) { _, _ in }
            case "manageSeasons":
                ManageSeasonsSheet(
                    libraryId: 1,
                    seasons: Self.seasons.map { $0.number == 5 ? SeasonInfo(number: 5, episodes: 6, airDate: $0.airDate, aired: 3) : $0 },
                    current: SeasonDraft(mode: .pick, picked: [4, 5], monitorNew: true)
                ) {}
            default:
                AddTitleSheet(request: request(show, admin: true))
            }
        }
    }
#endif
