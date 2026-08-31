#if DEBUG
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
            DebugPlayer(chapterCount: 63, resumeAt: 15_120)
        case "playerNoChapters":
            DebugPlayer(chapterCount: 0, resumeAt: 15_120)
        default:
            EmptyView()
        }
    }

    static func isOffline(_ screen: String) -> Bool {
        ["player", "playerNoChapters"].contains(screen)
    }
}

/// Loads the first library item of a type and shows its detail — avoids having
/// to know real tmdb/library ids for a screenshot.
struct DebugFirstDetail: View {
    @EnvironmentObject private var model: AppModel
    let libraryType: String   // "movie" | "show"

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
                        libraryId: media.id
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
        media = try? await client.libraryList(type: libraryType).items.first
        if media == nil { failed = true }
    }
}

/// Shows a book's detail — prefers an ebook-only book so the merged view and
/// the "Add audiobook" flow are visible.
struct DebugFirstBook: View {
    @EnvironmentObject private var model: AppModel
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Group {
                if let book = pick() {
                    BookView(book: book)
                } else if loaded {
                    Text("No books").foregroundStyle(Theme.muted)
                } else {
                    ProgressView().tint(Theme.apricot)
                }
            }
            .background(Theme.base)
        }
        .task {
            if model.library.isEmpty { await model.loadLibrary() }
            loaded = true
        }
    }

    private func pick() -> BookListItem? {
        model.library.first { $0.hasEbook && !$0.hasAudiobook } ?? model.library.first
    }
}

/// Shows the release-search sheet content for the first library movie.
struct DebugFirstReleaseSearch: View {
    @EnvironmentObject private var model: AppModel

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
            media = try? await client.libraryList(type: "movie").items.first
            if media == nil { failed = true }
        }
    }
}

/// Renders `PlayerView` against a synthetic manifest, so the scrubber can be
/// screenshotted on the simulator with no server, no credentials and no real
/// audio. The chapter shape is what decides which scrubber branch renders, and
/// that is exactly what needs reviewing.
///
/// `RAWKOON_SCREEN=player` — 63 chapters resumed mid-book: the chapter-scoped
/// scrubber. `RAWKOON_SCREEN=playerNoChapters` — no chapter timeline at all,
/// which is the shape a single-file m4b edition has and the whole-book fallback
/// it must take.
struct DebugPlayer: View {
    @EnvironmentObject private var model: AppModel
    /// Zero means "no chapter timeline", which is the fallback case.
    let chapterCount: Int
    let resumeAt: Double

    @State private var manifest: BookManifest?

    private static let chapterSecs: Double = 552  // the real library's mean

    var body: some View {
        Group {
            if let manifest {
                PlayerView(summary: summary(for: manifest), manifest: manifest)
            } else {
                ProgressView().tint(Theme.apricot)
            }
        }
        .background(Theme.base)
        .task { load() }
    }

    private func summary(for manifest: BookManifest) -> LibrarySummary {
        LibrarySummary(
            editionId: manifest.editionId,
            bookId: manifest.bookId,
            title: manifest.title,
            author: manifest.authors.first,
            coverURL: nil,
            durationSecs: manifest.totalDurationSecs
        )
    }

    private func load() {
        guard manifest == nil else { return }
        guard let decoded = Self.syntheticManifest(chapterCount: chapterCount) else { return }
        manifest = decoded
        // Any resolvable host will do: the queue only needs URLs it can build
        // AVPlayerItems from, and nothing is ever played here.
        guard let baseURL = URL(string: "https://screenshot.invalid") else { return }
        model.player.load(manifest: decoded, baseURL: baseURL, resumeAt: resumeAt)
    }

    /// Built as JSON and decoded, because RawkoonKit exposes no public
    /// initialiser for these types.
    private static func syntheticManifest(chapterCount: Int) -> BookManifest? {
        var chapters: [String] = []
        for index in 0..<chapterCount {
            let start = Double(index) * chapterSecs
            let title = index == 0 ? "Prologue"
                : index == chapterCount - 1 ? "Epilogue"
                : "Chapitre \(index)"
            chapters.append("""
            {"index":\(index),"title":"\(title)","start_secs":\(start),\
            "end_secs":\(start + chapterSecs),"file_id":\(1000 + index),\
            "size_bytes":5000000,"sha256":null,\
            "url":"/api/books/files/\(1000 + index)/content?grant=debug"}
            """)
        }
        let total = chapterCount > 0 ? Double(chapterCount) * chapterSecs : 34_748
        let json = """
        {"edition_id":63,"book_id":9,"title":"La femme de ménage",\
        "authors":["Freida McFadden"],"total_duration_secs":\(total),\
        "chapters":[\(chapters.joined(separator: ","))]}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try? decoder.decode(BookManifest.self, from: Data(json.utf8))
    }
}

#endif
