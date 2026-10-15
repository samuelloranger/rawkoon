import Foundation
import RawkoonKit

// "Read from here" / "Listen from here": jump between a book's audiobook and
// ebook at the same sentence. The server matches the spot; this saves it and
// opens the other format.

extension AppModel {
    /// The audiobook's current spot, opened in the ebook reader. Nil (after a
    /// toast) when the server cannot match it or the ebook cannot be opened, and
    /// nil without a toast when the calling task was cancelled.
    func readFromHere(bookId: Int, title: String, positionSecs: Double) async -> EbookPreviewDocument? {
        guard let client = api(),
              let ebookEditionId = library.first(where: { $0.bookId == bookId })?.ebookEditionId
        else { return nil }

        let spot: BookHandoff.EbookSpot
        do {
            spot = try await client.handoffToEbook(bookId: bookId, positionSecs: positionSecs)
        } catch {
            if !Task.isCancelled {
                toastHandoffFailure(error)
            }
            return nil
        }
        guard !Task.isCancelled else { return nil }

        // Separate from the handoff call: a download failure is not a transcription failure.
        let stored = readingProgressStore.position(editionId: ebookEditionId)
        let document: EbookPreviewDocument
        do {
            document = try await ebookDocument(
                bookId: bookId,
                editionId: ebookEditionId,
                title: title,
                preferredFileId: stored?.fileId
            )
        } catch {
            if !Task.isCancelled {
                toastEbookOpenFailure(error)
            }
            return nil
        }
        guard !Task.isCancelled else { return nil }

        player.pause()
        saveReadingPosition(BookHandoff.readingPosition(
            from: spot,
            editionId: ebookEditionId,
            fileId: document.id,
            knownSpineCount: stored?.spineCount,
            nowMillis: Int64(Date().timeIntervalSince1970 * 1000)
        ))
        return document
    }

    /// The ebook's current spot, played in the audiobook. False (after a toast)
    /// when it could not be matched or the player failed to load; false without
    /// a toast when the calling task was cancelled.
    func listenFromHere(bookId: Int, spinePath: String, progression: Double) async -> Bool {
        guard let client = api(),
              let editionId = library.first(where: { $0.bookId == bookId })?.audiobookEditionId
        else { return false }
        let positionSecs: Double
        do {
            positionSecs = try await client.handoffToAudiobook(
                bookId: bookId, spinePath: spinePath, progression: progression
            )
        } catch {
            if !Task.isCancelled {
                toastHandoffFailure(error)
            }
            return false
        }
        guard !Task.isCancelled else { return false }
        await openPlayer(editionId: editionId, resumeAt: positionSecs)
        if let error = errorMessage {
            toast(error, style: .error)
            return false
        }
        guard !Task.isCancelled else { return false }
        player.play()
        return true
    }

    /// Asks the root to show the full player once whatever sheet is closing has gone.
    func presentPlayerAfterDismiss() {
        Task {
            try? await Task.sleep(for: .milliseconds(600))
            playerPresentationRequest += 1
        }
    }

    private func toastHandoffFailure(_ error: Error) {
        Log.network.error("book handoff failed: \(String(describing: error), privacy: .public)")
        let message = (error as? APIError)?.handoffMessage
            ?? String(localized: "Couldn't reach the transcription service.")
        toast(message, style: .error)
    }

    private func toastEbookOpenFailure(_ error: Error) {
        Log.network.error("book handoff ebook open failed: \(String(describing: error), privacy: .public)")
        if case EbookContinueError.missingRemoteURL = error {
            toast(String(localized: "This server version cannot provide ebook download links yet."), style: .error)
        } else {
            toast(String(localized: "Couldn't open the ebook."), style: .error)
        }
    }
}
