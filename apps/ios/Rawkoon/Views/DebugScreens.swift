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
                DebugPlayer(chapterCount: 63, resumeAt: 15120)
            case "playerNoChapters":
                DebugPlayer(chapterCount: 0, resumeAt: 15120)
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
            if media == nil {
                failed = true
            }
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
                if model.library.isEmpty {
                    await model.loadLibrary()
                }
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
                if media == nil {
                    failed = true
                }
            }
        }
    }

    /// Wraps the real tab bar and opens the first audiobook, so the mini player
    /// can be screenshotted without tap injection — `simctl` cannot tap, and the
    /// bar only appears once a book is loaded.
    struct DebugMiniPlayer<Content: View>: View {
        @EnvironmentObject private var model: AppModel
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
        @EnvironmentObject private var model: AppModel
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
        private static func syntheticManifest(chapterCount: Int) -> BookManifest? {
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
            {"edition_id":63,"book_id":9,"title":"La femme de ménage",\
            "authors":["Freida McFadden"],"total_duration_secs":\(total),\
            "chapters":[\(chapters.joined(separator: ","))]}
            """
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try? decoder.decode(BookManifest.self, from: Data(json.utf8))
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
        @EnvironmentObject private var model: AppModel

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
            let book: BookListItem?
            if let requested {
                book = model.library.first { $0.audiobookEditionId == requested }
            } else {
                book = model.library.first { $0.hasAudiobook }
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

    /// Opens the EPUB reader on a real book from the signed-in server, downloading
    /// the file first if it is not already local.
    ///
    /// `RAWKOON_BOOK` picks the book id; without it the first book with an ebook
    /// edition is used. This is the only way to reach the reader on the simulator
    /// without tap injection, and the reader is the one screen whose output cannot
    /// be judged from a compile.
    struct DebugEbookReader: View {
        @EnvironmentObject private var model: AppModel

        @State private var document: EbookPreviewDocument?
        @State private var failure: String?

        var body: some View {
            Group {
                if let document {
                    EbookReaderSheet(document: document)
                } else if let failure {
                    Text(failure)
                        .font(.subheadline)
                        .foregroundStyle(Theme.terracotta)
                        .multilineTextAlignment(.center)
                        .padding(24)
                } else {
                    VStack(spacing: 10) {
                        ProgressView().tint(Theme.importing)
                        Text("Fetching the book…")
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
            .background(Theme.base)
            .task { await load() }
        }

        private func load() async {
            guard document == nil, failure == nil else { return }

            // Offline path: with RAWKOON_LOCAL_EDITION and RAWKOON_LOCAL_FILE set,
            // the document is built straight from disk with no API call at all, so a
            // run against an unreachable server proves the reader needs no network.
            let env = ProcessInfo.processInfo.environment
            if
                let editionId = Int(env["RAWKOON_LOCAL_EDITION"] ?? ""),
                let fileId = Int(env["RAWKOON_LOCAL_FILE"] ?? "")
            {
                let localURL = FileStore.chapterURL(editionId: editionId, fileId: fileId, ext: "epub")
                guard FileManager.default.fileExists(atPath: localURL.path) else {
                    failure = "Not downloaded: \(localURL.lastPathComponent)"
                    return
                }
                document = EbookPreviewDocument(
                    id: fileId,
                    editionId: editionId,
                    language: env["RAWKOON_LOCAL_LANGUAGE"],
                    title: "Offline",
                    localURL: localURL
                )
                return
            }

            guard let client = model.api() else { failure = "No API client"; return }

            if model.library.isEmpty {
                await model.loadLibrary()
            }

            let requested = Int(ProcessInfo.processInfo.environment["RAWKOON_BOOK"] ?? "")
            let book: BookListItem?
            if let requested {
                book = model.library.first { $0.bookId == requested }
            } else {
                book = model.library.first { $0.hasEbook }
            }
            guard let book else {
                failure = "No book \(requested.map(String.init) ?? "with an ebook") in the library"
                return
            }

            guard
                let files = try? await client.bookEditionFiles(bookId: book.bookId, kind: "ebook"),
                let file = files.first(where: { $0.format.lowercased() == "epub" }) ?? files.first
            else {
                failure = "Book \(book.bookId) has no ebook files"
                return
            }

            let editionId = book.ebookEditionId ?? (1_000_000_000 + book.bookId)
            let ext = URL(fileURLWithPath: file.fileName).pathExtension.lowercased()
            let localURL = FileStore.chapterURL(
                editionId: editionId,
                fileId: file.id,
                ext: ext.isEmpty ? "epub" : ext
            )

            if !FileManager.default.fileExists(atPath: localURL.path) {
                guard let remote = model.absoluteURL(file.contentUrl) else {
                    failure = "No signed content URL for file \(file.id)"
                    return
                }
                do {
                    let (temp, response) = try await URLSession.shared.download(from: remote)
                    guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
                        failure = "Download failed (HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0))"
                        return
                    }
                    try FileManager.default.createDirectory(
                        at: localURL.deletingLastPathComponent(),
                        withIntermediateDirectories: true
                    )
                    try FileManager.default.moveItem(at: temp, to: localURL)
                } catch {
                    failure = "Download failed: \(error.localizedDescription)"
                    return
                }
            }

            let language = try? await client.bookDetail(bookId: book.bookId).language
            document = EbookPreviewDocument(
                id: file.id,
                editionId: book.ebookEditionId,
                language: language,
                title: book.title,
                localURL: localURL
            )
        }
    }

#endif
