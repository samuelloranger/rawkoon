import Foundation
import RawkoonKit

// "Read from here" / "Listen from here": jump between a book's audiobook and
// ebook at the same sentence. The server matches the spot; this saves it and
// opens the other format.

extension AppModel {
    /// The audiobook's current spot, opened in the ebook reader. Nil (after a
    /// toast) when the server cannot match it or the ebook cannot be opened.
    func readFromHere(bookId: Int, title: String, positionSecs: Double) async -> EbookPreviewDocument? {
        guard let client = api(),
              let ebookEditionId = library.first(where: { $0.bookId == bookId })?.ebookEditionId
        else { return nil }
        do {
            let spot = try await client.handoffToEbook(bookId: bookId, positionSecs: positionSecs)
            let stored = readingProgressStore.position(editionId: ebookEditionId)
            let document = try await ebookDocument(
                bookId: bookId,
                editionId: ebookEditionId,
                title: title,
                preferredFileId: stored?.fileId
            )
            player.pause()
            saveReadingPosition(BookHandoff.readingPosition(
                from: spot,
                editionId: ebookEditionId,
                fileId: document.id,
                knownSpineCount: stored?.spineCount,
                nowMillis: Int64(Date().timeIntervalSince1970 * 1000)
            ))
            return document
        } catch {
            toastHandoffFailure(error)
            return nil
        }
    }

    /// The ebook's current spot, played in the audiobook. False (after a toast)
    /// when it could not be matched or the player failed to load.
    func listenFromHere(bookId: Int, spinePath: String, progression: Double) async -> Bool {
        guard let client = api(),
              let editionId = library.first(where: { $0.bookId == bookId })?.audiobookEditionId
        else { return false }
        do {
            let positionSecs = try await client.handoffToAudiobook(
                bookId: bookId, spinePath: spinePath, progression: progression
            )
            await openPlayer(editionId: editionId, resumeAt: positionSecs)
            if let error = errorMessage {
                toast(error, style: .error)
                return false
            }
            player.play()
            return true
        } catch {
            toastHandoffFailure(error)
            return false
        }
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
        switch error {
        case let apiError as APIError:
            toast(apiError.handoffMessage, style: .error)
        case EbookContinueError.missingRemoteURL:
            toast(String(localized: "This server version cannot provide ebook download links yet."), style: .error)
        default:
            toast(String(localized: "Couldn't reach the transcription service."), style: .error)
        }
    }
}
