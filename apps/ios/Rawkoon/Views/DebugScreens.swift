#if DEBUG
import SwiftUI

/// Debug-only screenshot harness. When `RAWKOON_SCREEN` is set in the launch
/// environment, the app renders that screen in isolation (after autologin)
/// instead of the tab bar, so pushed/sheet screens can be captured on the
/// simulator without tap injection. Compiled out of Release/TestFlight builds.
enum DebugScreen {
    static var requested: String? {
        ProcessInfo.processInfo.environment["RAWKOON_SCREEN"]
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
#endif
