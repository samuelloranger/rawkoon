#if DEBUG
    // motion-ok-file: debug-only harness
    import RawkoonKit
    import SwiftUI

    /// Opens the EPUB reader on a real book from the signed-in server, downloading
    /// the file first if it is not already local.
    ///
    /// `RAWKOON_BOOK` picks the book id; without it the first book with an ebook
    /// edition is used. This is the only way to reach the reader on the simulator
    /// without tap injection, and the reader is the one screen whose output cannot
    /// be judged from a compile.
    struct DebugEbookReader: View {
        @Environment(AppModel.self) private var model

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

            if model.libraryStore.library.isEmpty {
                await model.libraryStore.loadLibrary()
            }

            let requested = Int(ProcessInfo.processInfo.environment["RAWKOON_BOOK"] ?? "")
            let book: BookListItem? = if let requested {
                model.libraryStore.library.first { $0.bookId == requested }
            } else {
                model.libraryStore.library.first { $0.hasEbook }
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
                guard model.absoluteURL(file.contentUrl) != nil else {
                    failure = "No signed content URL for file \(file.id)"
                    return
                }
                do {
                    let temp = try await client.downloadFile(path: file.contentUrl ?? "")
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
