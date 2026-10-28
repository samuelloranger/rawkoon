#if DEBUG
    // motion-ok-file: debug-only harness
    import RawkoonKit
    import SwiftUI

    /// Debug-only screenshot harness. When `RAWKOON_SCREEN` is set in the launch
    /// environment, the app renders that screen in isolation (after autologin)
    /// instead of the tab bar, so pushed/sheet screens can be captured on the
    /// simulator without tap injection. Compiled out of Release/TestFlight builds.
    enum DebugScreen {
        static var requested: String? {
            ProcessInfo.processInfo.environment["RAWKOON_SCREEN"]
        }

        /// Screens that need no server, so they render BEFORE the login gate.
        ///
        /// The rest of the harness lives inside `RootTabsView` and therefore only
        /// exists once autologin has succeeded, which needs credentials in the
        /// launch environment. A screen driven entirely by synthetic data should not
        /// need any of that to be screenshotted.
        @ViewBuilder
        static func offlineView(for screen: String) -> some View {
            switch screen {
            case "player":
                DebugPlayer(chapterCount: 63, resumeAt: 15120)
            case "playerNoChapters":
                DebugPlayer(chapterCount: 0, resumeAt: 15120)
            case "deck":
                DebugDeck()
            case "tabBar":
                DebugTabBarStates()
            case "tabContainer":
                DebugTabContainer()
            case "orderedSources":
                DebugOrderedSources()
            case "bookDiscoveryDetail":
                NavigationStack {
                    DiscoveryBookDetailView(book: BookDiscoveryBook(
                        rank: 1,
                        title: "C'était ça ou mourir",
                        isbn13: "9782764629253",
                        coverUrl: "https://images.leslibraires.ca/books/9782764629253/front/9782764629253_large.webp",
                        sourceUrl: "https://www.leslibraires.ca/livres/c-etait-ca-ou-mourir-9782764629253",
                        author: "Thélyson Orélien",
                        overview: """
                        Quand mon quartier a brûlé, j'ai ri comme un idiot. Devant l'horreur, \
                        plutôt que de pleurer, Jonas Dorléon choisit de rire. Rire et marcher. \
                        Prof d'histoire et de géographie à Carrefour-Feuilles, un quartier \
                        densément peuplé de Port-au-Prince, Jonas est contraint de quitter sa maison.
                        """,
                        publishedYear: 2026,
                        volumeId: nil,
                        alreadyInLibrary: false,
                        request: nil
                    ))
                }
            case "motionKit":
                DebugMotionGallery()
            default:
                featureView(for: screen)
            }
        }

        /// AI settings and auto search screens, split out to keep each switch small.
        @ViewBuilder
        private static func featureView(for screen: String) -> some View {
            switch screen {
            case "aiConfig":
                DebugAiSettings(scrollTo: nil)
            case "aiPrices":
                DebugAiSettings(scrollTo: "ai-prices")
            case "aiUsage":
                DebugAiSettings(scrollTo: "ai-usage")
            case "aiStats":
                DebugAiSettings(scrollTo: "ai-stats")
            case "aiCharts":
                DebugAiSettings(scrollTo: "ai-charts")
            case "aiGrabs":
                DebugAiSettings(scrollTo: "ai-grabs")
            case "aiHistory":
                DebugAiHistory(detail: false)
            case "aiCallDetail":
                DebugAiHistory(detail: true)
            case "aiBanner":
                DebugAiBanner(budgetReached: false)
            case "aiBannerBudget":
                DebugAiBanner(budgetReached: true)
            case "autoSearchIdle":
                DebugAutoSearch(searching: false, dialog: false)
            case "autoSearchBusy":
                DebugAutoSearch(searching: true, dialog: false)
            case "upgradeDialog":
                DebugAutoSearch(searching: false, dialog: true)
            case "liveSearchToasts":
                DebugLiveSearchToasts()
            case "growthAdmin":
                DebugGrowth(admin: true, showBooks: true)
            case "growthMember":
                DebugGrowth(admin: false, showBooks: true)
            case "growthNoBooks":
                DebugGrowth(admin: false, showBooks: false)
            case "releaseNotes":
                NavigationStack { ReleaseNotesView(release: DebugReleaseNotes.release, repo: "owner/app") }
            default:
                EmptyView()
            }
        }

        static func isOffline(_ screen: String) -> Bool {
            [
                "player", "playerNoChapters", "deck", "orderedSources",
                "bookDiscoveryDetail", "tabBar", "tabContainer", "aiConfig", "aiPrices", "aiUsage", "aiStats", "aiCharts",
                "aiGrabs", "aiHistory", "aiCallDetail", "aiBanner", "aiBannerBudget",
                "autoSearchIdle", "autoSearchBusy", "upgradeDialog", "motionKit",
                "growthAdmin", "growthMember", "growthNoBooks", "liveSearchToasts",
                "releaseNotes",
            ].contains(screen)
        }
    }

    /// Renders the ranked source list against synthetic data — no server, no
    /// credentials. The ordering UI is the whole point of the screen, so a seeded
    /// selection is enough to review it.
    struct DebugOrderedSources: View {
        @State private var sources = ["BluRay", "WEB-DL", "HDTV"]

        var body: some View {
            NavigationStack {
                OrderedMultiSelectList(
                    titleKey: "Preferred sources",
                    selected: $sources,
                    options: QualityProfileSources.options.map { ($0.value, Text($0.label)) }
                )
            }
        }
    }

    /// Loads the first library item of a type and shows its detail — avoids having
    /// to know real tmdb/library ids for a screenshot.
    struct DebugFirstDetail: View {
        @Environment(AppModel.self) private var model
        let libraryType: String // "movie" | "show"

        @State private var media: LibraryMedia?
        @State private var failed = false

        var body: some View {
            NavigationStack {
                Group {
                    if let media {
                        MediaDetailView(
                            tmdbId: media.tmdbId,
                            mediaType: libraryType == "show" ? "tv" : "movie",
                            title: media.title,
                            posterPath: media.posterUrl,
                            libraryId: media.id,
                            focusManagement: ProcessInfo.processInfo.environment["RAWKOON_FOCUS_MANAGEMENT"] != nil
                        )
                    } else if failed {
                        Text("No \(libraryType) in library").foregroundStyle(Theme.muted)
                    } else {
                        ProgressView().tint(Theme.apricot)
                    }
                }
                .background(Theme.base)
            }
            .task { await load() }
        }

        private func load() async {
            guard let client = model.api() else { return }
            // An index picks from the prefetched recent list, to show a never-opened title offline.
            if let raw = ProcessInfo.processInfo.environment["RAWKOON_DETAIL_INDEX"], let index = Int(raw) {
                let recent = client.cached(Endpoints.libraryList(
                    page: 1, limit: 100, sortBy: "added_at", sortDir: "desc"
                ))?.value.items.filter { $0.type == libraryType } ?? []
                media = recent.indices.contains(index) ? recent[index] : nil
            } else {
                // Falls back to the saved list so the offline screenshot run has a title to open.
                media = await (try? client.libraryList(type: libraryType, limit: 1))?.items.first
                    ?? client.cached(Endpoints.libraryList(type: libraryType, limit: 1))?.value.items.first
            }
            if media == nil {
                failed = true
            }
        }
    }

    /// Shows a book's detail — prefers an ebook-only book so the merged view and
    /// the "Add audiobook" flow are visible.
    struct DebugFirstBook: View {
        @Environment(AppModel.self) private var model
        @State private var loaded = false

        var body: some View {
            NavigationStack {
                Group {
                    if let book = pick() {
                        BookView(book: book)
                            .id(book.bookId)
                    } else if loaded {
                        Text("No books").foregroundStyle(Theme.muted)
                    } else {
                        ProgressView().tint(Theme.apricot)
                    }
                }
                .background(Theme.base)
            }
            .task {
                if model.library.isEmpty {
                    await model.loadLibrary()
                }
                loaded = true
            }
        }

        private func pick() -> BookListItem? {
            if let raw = ProcessInfo.processInfo.environment["RAWKOON_BOOK"],
               let id = Int(raw)
            {
                return model.library.first { $0.bookId == id }
            }
            return model.library.first { $0.hasEbook && !$0.hasAudiobook } ?? model.library.first
        }
    }

    /// Shows the release-search sheet content for the first library movie.
    struct DebugFirstReleaseSearch: View {
        @Environment(AppModel.self) private var model

        @State private var media: LibraryMedia?
        @State private var failed = false

        var body: some View {
            Group {
                if let media {
                    ReleaseSearchView(
                        query: media.title,
                        libraryMediaId: media.id,
                        tmdbId: media.tmdbId,
                        mediaType: "movie"
                    )
                } else if failed {
                    Text("No movie in library").foregroundStyle(Theme.muted)
                } else {
                    ProgressView().tint(Theme.apricot)
                }
            }
            .background(Theme.base)
            .task {
                guard let client = model.api() else { return }
                let items = await (try? client.libraryList(type: "movie").items) ?? []
                let wanted = ProcessInfo.processInfo.environment["RAWKOON_RELEASE_MEDIA"].flatMap(Int.init)
                media = items.first { $0.id == wanted } ?? items.first
                if media == nil {
                    failed = true
                }
            }
        }
    }

    /// `RAWKOON_SCREEN=releaseNotes`: every block the notes renderer lays out.
    enum DebugReleaseNotes {
        static let release = GithubReleaseDTO(
            tagName: "v2.4.0", name: "v2.4.0 — Chapter names from the epub", publishedAt: "2026-10-27T14:00:00Z",
            body: """
            Chapters get real names, and a movie and a show that share an id no longer \
            overwrite each other. Update the app along with the server.

            ### Highlights

            - **Chapter names from the epub** (#387, #389). Multi-file audiobooks now read \
            the epub's table of contents and match it to the files.
            - **Movies and shows are kept apart** (#392). The library is unique on the id and the type.

            ### Changed

            - **Status contract** (#398). `status` is now one of `wanted` or `downloaded`.
            - **Pipeline restructured** (#393, #394):
              - Adoption sits behind the client adapter.
              - Outcome notifications go through one port.

            > Older app builds show airing shows as Downloaded until updated.

            ### Upgrade notes

            1. Two migrations run on boot.
            2. Roll back by restoring the dump:

            ```bash
            docker compose pull && docker compose up -d
            ```
            """,
            htmlUrl: "https://github.com/owner/app/releases/tag/v2.4.0", prerelease: false,
            author: GithubReleaseAuthorDTO(login: "maintainer"), assets: []
        )
    }
#endif
