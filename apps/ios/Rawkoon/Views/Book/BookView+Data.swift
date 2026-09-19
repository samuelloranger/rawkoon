import Foundation
import RawkoonKit
import SwiftUI

extension BookView {
    /// Chapters first, then ebook files. Fetching ebooks first used to leave the
    /// chapter list in its idle state (now a spinner; previously the default
    /// "Chapters couldn't load" error) for the whole ebook GET. Starting the
    /// manifest first also avoids a MainActor deadlock from overlapping the two.
    /// The stored resume point when it falls inside this chapter, so the row can
    /// offer it instead of the chapter's own start. `endSecs` is exclusive — a
    /// position exactly on a boundary belongs to the chapter that begins there.
    func resumePosition(in chapter: ManifestChapter) -> Double? {
        guard case let .resume(positionSecs) = audiobookResume else { return nil }
        guard positionSecs >= chapter.startSecs, positionSecs < chapter.endSecs else { return nil }
        return positionSecs
    }

    func loadResumePreview() async {
        guard let editionId = audiobookEditionId else { return }
        await model.loadResumePreview(editionId: editionId, totalDurationSecs: audiobookTotalSecs)
    }

    func loadReadingResumePreview() async {
        guard let editionId = ebookEditionId else { return }
        await model.loadReadingResumePreview(editionId: editionId)
    }

    func refreshAll(forceManifestRefresh: Bool) async {
        seedManifestFromCache()
        await loadBookDetail()
        seedManifestFromCache()
        if hasAudiobookEdition {
            await fetchManifest(forceRefresh: forceManifestRefresh)
        } else {
            manifest = nil
            manifestError = nil
            fetchAttemptedManifest = true
        }
        if hasAudiobookEdition {
            await loadResumePreview()
        }
        if hasEbookEdition {
            await loadEbookFiles()
            await loadReadingResumePreview()
        } else {
            ebookFiles = []
            ebookFilesError = nil
        }
    }

    func loadBookDetail() async {
        guard let client = model.api() else { return }
        loadingDetail = true
        detailError = nil
        defer { loadingDetail = false }
        do {
            detail = try await client.bookDetail(bookId: book.bookId)
            alignLaneToAvailableEditions()
        } catch let apiError as APIError {
            // A transport failure means we're offline; the screen still works
            // from the library row and any downloaded files, so don't raise a
            // network-error wall for it.
            if case .transport = apiError {
                detailError = nil
            } else {
                detailError = message(for: apiError)
            }
        } catch {
            detailError = String(localized: "Could not load book details.")
        }
    }

    func alignLaneToAvailableEditions() {
        if activeLane == .audiobook, !hasAudiobookEdition, hasEbookEdition {
            activeLane = .ebook
        } else if activeLane == .ebook, !hasEbookEdition, hasAudiobookEdition {
            activeLane = .audiobook
        }
    }

    func addEdition(kind: String) async {
        guard let client = model.api() else { return }
        addingEditionKind = kind
        defer { addingEditionKind = nil }
        do {
            try await client.addBookEdition(bookId: book.bookId, kind: kind)
            await model.loadLibrary()
            await loadBookDetail()
            if kind == "audiobook" {
                activeLane = .audiobook
                await fetchManifest(forceRefresh: true)
            } else {
                activeLane = .ebook
                await loadEbookFiles()
            }
        } catch let apiError as APIError {
            if kind == "audiobook" {
                manifestError = message(for: apiError)
            } else {
                ebookFilesError = message(for: apiError)
            }
        } catch {
            if kind == "audiobook" {
                manifestError = String(localized: "Could not add audiobook edition.")
            } else {
                ebookFilesError = String(localized: "Could not add ebook edition.")
            }
        }
    }

    func seedManifestFromCache() {
        guard manifest == nil, let editionId = audiobookEditionId else { return }
        let cached = model.cachedManifest(editionId)
            ?? DownloadedStore.readManifest(editionId: editionId)
        guard let cached, !cached.chapters.isEmpty else { return }
        manifest = cached
        fetchAttemptedManifest = true
        loadingManifest = false
    }

    func fetchManifest(forceRefresh: Bool = false) async {
        guard let editionId = audiobookEditionId else {
            fetchAttemptedManifest = true
            return
        }
        seedManifestFromCache()
        fetchAttemptedManifest = true

        // Disk/cache is enough to list chapters. Blocking on the network here
        // is what left a spinner up after a kill even with manifest.json on disk.
        if !forceRefresh, let existing = manifest, !existing.chapters.isEmpty {
            loadingManifest = false
            return
        }

        loadingManifest = true
        manifestError = nil
        defer { loadingManifest = false }
        do {
            manifest = try await model.manifest(editionId, forceRefresh: forceRefresh)
            attemptedAutomaticRecovery = false
        } catch let apiError as APIError {
            if manifest == nil {
                manifestError = message(for: apiError)
                if
                    case .http(400) = apiError,
                    model.isAdmin,
                    !attemptedAutomaticRecovery,
                    !forceRefresh
                {
                    attemptedAutomaticRecovery = true
                    await recoverManifestAfterRescan()
                }
            }
        } catch {
            if manifest == nil {
                manifestError = String(localized: "Could not load manifest.")
            }
        }
    }

    func recoverManifestAfterRescan() async {
        guard let editionId = audiobookEditionId, let client = model.api() else { return }
        rescanningManifest = true
        defer { rescanningManifest = false }

        do {
            _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "audiobook")
            manifest = try await model.manifest(editionId, forceRefresh: true)
            manifestError = nil
            await model.loadLibrary()
            await loadBookDetail()
        } catch let apiError as APIError {
            manifest = nil
            manifestError = message(for: apiError)
        } catch {
            manifest = nil
            manifestError = String(localized: "Rescan completed, but chapters are still unavailable.")
        }
    }

    func loadEbookFiles() async {
        guard hasEbookEdition, let client = model.api() else { return }
        loadingEbookFiles = true
        ebookFilesError = nil
        defer { loadingEbookFiles = false }
        do {
            ebookFiles = try await client.bookEditionFiles(bookId: book.bookId, kind: "ebook")
        } catch {
            // Offline / server unreachable: fall back to the persisted file list
            // so a downloaded ebook can still be opened. Only when there is no
            // cached list do we surface an error.
            if let cached = model.offlineEbookFiles(editionId: ebookStorageEditionId), !cached.isEmpty {
                ebookFiles = cached
                ebookFilesError = nil
            } else {
                ebookFiles = []
                ebookFilesError = (error as? APIError).map(message(for:)) ?? String(localized: "Could not load ebook files.")
            }
        }
    }

    func rescanEbookEdition() async {
        guard let client = model.api() else { return }
        rescanningEbook = true
        defer { rescanningEbook = false }
        do {
            _ = try await client.rescanBookEdition(bookId: book.bookId, kind: "ebook")
            await model.loadLibrary()
            await loadBookDetail()
            await loadEbookFiles()
        } catch let apiError as APIError {
            ebookFilesError = message(for: apiError)
        } catch {
            ebookFilesError = String(localized: "Could not rescan ebook edition.")
        }
    }

    func openEbook(_ file: BookEditionFile, startFromBeginning: Bool = false) async {
        openingEbookFileId = file.id
        ebookFilesError = nil
        defer { openingEbookFileId = nil }
        do {
            let localURL = try await ensureLocalEbookFile(file)
            previewDocument = EbookPreviewDocument(
                id: file.id,
                // The real edition id, not ebookStorageEditionId: reading
                // progress is stored server-side per edition, and the synthetic
                // fallback id does not exist there.
                editionId: ebookEditionId,
                // Rawkoon's language, not the EPUB's: an EPUB can list several
                // and the reader takes the first, which laid a French novel out
                // right-to-left.
                language: detail?.language,
                title: file.fileName,
                localURL: localURL,
                startFromBeginning: startFromBeginning
            )
        } catch EbookStorageError.missingRemoteURL {
            ebookFilesError = String(localized: "This server version cannot provide ebook download links yet.")
        } catch {
            ebookFilesError = String(localized: "Read failed. Try refreshing or rescanning this edition.")
        }
    }

    /// Starts a cancelable ebook download, tracking the task so a Cancel tap can
    /// stop it. Runs on the main actor because it mutates view state.
    func startEbookDownload(_ file: BookEditionFile) {
        guard ebookDownloadTasks[file.id] == nil else { return }
        let task = Task { await downloadEbook(file) }
        ebookDownloadTasks[file.id] = task
    }

    /// Cancels an in-flight ebook download. `downloadEbook`'s cleanup clears the
    /// tracking state and swallows the resulting cancellation quietly.
    func cancelEbookDownload(_ file: BookEditionFile) {
        ebookDownloadTasks[file.id]?.cancel()
    }

    func downloadEbook(_ file: BookEditionFile) async {
        guard !downloadingEbookFileIDs.contains(file.id) else { return }
        downloadingEbookFileIDs.insert(file.id)
        ebookFilesError = nil
        defer {
            downloadingEbookFileIDs.remove(file.id)
            ebookDownloadTasks.removeValue(forKey: file.id)
        }
        do {
            _ = try await ensureLocalEbookFile(file)
            // Persist enough to list and open this ebook offline.
            model.recordEbookDownloaded(
                editionId: ebookStorageEditionId,
                bookId: book.bookId,
                title: titleText,
                author: authorText.isEmpty ? nil : authorText,
                coverURL: coverURL,
                files: ebookFiles,
                downloadedFileCount: ebookFiles.filter(isEbookDownloaded).count
            )
        } catch EbookStorageError.missingRemoteURL {
            ebookFilesError = String(localized: "This server version cannot provide ebook download links yet.")
        } catch {
            // A user-initiated cancel surfaces as a transport error too; stay
            // silent rather than crying failure over an intentional stop.
            guard !Task.isCancelled else { return }
            ebookFilesError = String(localized: "Download failed. Check your connection and try again.")
        }
    }

    /// Deletes an offline ebook file from the device.
    func removeEbookDownload(_ file: BookEditionFile) {
        FileStore.delete(url: localEbookURL(for: file))
        ebookFileToRemove = nil
    }

    func ensureLocalEbookFile(_ file: BookEditionFile) async throws -> URL {
        let localURL = localEbookURL(for: file)
        if FileManager.default.fileExists(atPath: localURL.path) {
            return localURL
        }

        guard remoteEbookURL(for: file) != nil else {
            throw EbookStorageError.missingRemoteURL
        }
        guard let client = model.api() else {
            throw APIError.unauthorized
        }

        let temporaryURL = try await client.downloadFile(path: file.contentUrl ?? "")

        let parent = localURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)

        if FileManager.default.fileExists(atPath: localURL.path) {
            try FileManager.default.removeItem(at: localURL)
        }

        try FileManager.default.moveItem(at: temporaryURL, to: localURL)
        return localURL
    }
}
