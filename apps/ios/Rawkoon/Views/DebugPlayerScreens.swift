#if DEBUG
    // motion-ok-file: debug-only harness
    import RawkoonKit
    import SwiftUI

    /// Wraps the real tab bar and opens the first audiobook, so the mini player
    /// can be screenshotted without tap injection — `simctl` cannot tap, and the
    /// bar only appears once a book is loaded.
    struct DebugMiniPlayer<Content: View>: View {
        @Environment(AppModel.self) private var model
        @ViewBuilder let content: () -> Content

        var body: some View {
            content()
                .task {
                    if model.library.isEmpty {
                        await model.loadLibrary()
                    }
                    guard
                        model.activeEditionId == nil,
                        let editionId = model.library.first(where: { $0.hasAudiobook })?.audiobookEditionId
                    else { return }
                    await model.openPlayer(editionId: editionId)
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
        @Environment(AppModel.self) private var model
        /// Zero means "no chapter timeline", which is the fallback case.
        let chapterCount: Int
        let resumeAt: Double

        @State private var manifest: BookManifest?

        private static let chapterSecs: Double = 552 // the real library's mean

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
        static func syntheticManifest(chapterCount: Int) -> BookManifest? {
            var chapters: [String] = []
            for index in 0 ..< chapterCount {
                let start = Double(index) * chapterSecs
                let title = index == 0 ? "Prologue"
                    : index == chapterCount - 1 ? "Epilogue"
                    : "Chapitre \(index)"
                chapters.append("""
                {"index":\(index),"title":"\(title)","start_secs":\(start),\
                "end_secs":\(start + chapterSecs),"file_id":\(1000 + index),\
                "size_bytes":5000000,"sha256":null,\
                "url":"/api/books/files/\(1000 + index)/content.mp3?grant=debug"}
                """)
            }
            let total = chapterCount > 0 ? Double(chapterCount) * chapterSecs : 34748
            let json = """
            {"edition_id":63,"book_id":9,"title":"La veuve du ménestrel",\
            "authors":["Nora Whitfield"],"total_duration_secs":\(total),\
            "chapters":[\(chapters.joined(separator: ","))]}
            """
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try? decoder.decode(BookManifest.self, from: Data(json.utf8))
        }
    }

    /// `RAWKOON_SCREEN=deck` — the discover triage deck (Task 3, "Dusk in
    /// Motion") with three synthetic items, screenshotted with no server. Also
    /// the place to toggle Simulator Settings > Accessibility > Motion >
    /// Reduce Motion and re-screenshot to confirm the drag-follow disables.
    struct DebugDeck: View {
        private static let sample: [DiscoverDeckItem] = [
            DiscoverDeckItem(
                id: "movie-1", tmdbId: 1, mediaType: "movie", title: "Dusk in Motion",
                releaseYear: 2024, posterUrl: nil, overview: nil, voteAverage: 7.8, genreIds: []
            ),
            DiscoverDeckItem(
                id: "tv-2", tmdbId: 2, mediaType: "tv", title: "The Long Corridor",
                releaseYear: 2022, posterUrl: nil, overview: nil, voteAverage: 8.4, genreIds: []
            ),
            DiscoverDeckItem(
                id: "movie-3", tmdbId: 3, mediaType: "movie", title: "Amber Hour",
                releaseYear: 2019, posterUrl: nil, overview: nil, voteAverage: nil, genreIds: []
            ),
        ]

        var body: some View {
            ZStack {
                Theme.base.ignoresSafeArea()
                SwipeDeck(
                    items: Self.sample, label: "For you", primaryActionTitle: "Add",
                    onDismiss: { _ in }, onWatchlist: { _ in }, onPrimary: { _ in },
                    onExhausted: {}, onOpen: { _ in }
                )
            }
        }
    }

    /// Opens `PlayerView` on a REAL edition fetched from the signed-in server, so
    /// the scrubber can be reviewed against a real chapter timeline and real
    /// streaming audio rather than synthetic data.
    ///
    /// `RAWKOON_EDITION` picks the audiobook edition id; without it the first
    /// audiobook in the library is used. `RAWKOON_RESUME` is the whole-book position
    /// in seconds to resume at, so a screenshot can be taken mid-chapter rather than
    /// at a chapter boundary.
    struct DebugRealPlayer: View {
        @Environment(AppModel.self) private var model

        @State private var loaded: (summary: LibrarySummary, manifest: BookManifest)?
        @State private var failure: String?

        var body: some View {
            Group {
                if let loaded {
                    PlayerView(summary: loaded.summary, manifest: loaded.manifest)
                } else if let failure {
                    Text(failure)
                        .font(.subheadline)
                        .foregroundStyle(Theme.terracotta)
                        .multilineTextAlignment(.center)
                        .padding(24)
                } else {
                    ProgressView().tint(Theme.apricot)
                }
            }
            .background(Theme.base)
            .task { await load() }
        }

        private func load() async {
            guard loaded == nil, failure == nil else { return }
            let env = ProcessInfo.processInfo.environment
            let resumeAt = Double(env["RAWKOON_RESUME"] ?? "") ?? 15120

            if model.library.isEmpty {
                await model.loadLibrary()
            }

            let requested = Int(env["RAWKOON_EDITION"] ?? "")
            let book: BookListItem? = if let requested {
                model.library.first { $0.audiobookEditionId == requested }
            } else {
                model.library.first { $0.hasAudiobook }
            }

            guard let book, let summary = book.audiobookSummary else {
                failure = "No audiobook edition \(requested.map(String.init) ?? "") in the library"
                return
            }

            guard let manifest = try? await model.manifest(summary.editionId) else {
                failure = "Edition \(summary.editionId) has no manifest — it is not offline-ready"
                return
            }

            guard let baseURL = URL(string: model.serverURL) else {
                failure = "Server URL is not usable"
                return
            }

            model.player.load(manifest: manifest, baseURL: baseURL, resumeAt: resumeAt)
            loaded = (summary, manifest)

            // `RAWKOON_JUMP_TO` reproduces a chapter tap taken from an ALREADY
            // LOADED position: load at RAWKOON_RESUME, let the queue settle, then
            // seek. Seeking from a live queue is a different path from building
            // one at a position (`inPlaceSeekOffset` returns nil across a chapter,
            // so `buildQueue` runs against an existing player), and it is the path
            // a chapter tap actually takes.
            if let jumpRaw = env["RAWKOON_JUMP_TO"], let jumpTo = Double(jumpRaw) {
                let settle = UInt64(Double(env["RAWKOON_JUMP_DELAY"] ?? "") ?? 8)
                try? await Task.sleep(nanoseconds: settle * 1_000_000_000)
                Log.playback.error(
                    """
                    DEBUG jump: from=\(model.player.positionSecs, privacy: .public) \
                    to=\(jumpTo, privacy: .public)
                    """
                )
                model.player.seek(to: jumpTo)
                try? await Task.sleep(nanoseconds: 6 * 1_000_000_000)
                Log.playback.error(
                    """
                    DEBUG after jump: position=\(model.player.positionSecs, privacy: .public) \
                    chapterIndex=\(model.player.currentChapterIndex ?? -1, privacy: .public)
                    """
                )
            }
        }
    }
#endif
