import Foundation
import RawkoonKit

// Automatic "continue from the other format" suggestions. The decisions live in
// RawkoonKit's HandoffSuggestion; this gathers the timestamps and runs the
// server match. Every failure is silent: a banner nobody asked for must never
// toast.

/// What a banner offers, and when the other format reached that spot.
struct HandoffSuggestionBanner: Equatable, Identifiable {
    enum Target: Equatable {
        case ebook(BookHandoff.EbookSpot)
        case audiobook(positionSecs: Double)
    }

    let id = UUID()
    let target: Target
    let atMillis: Int64
    let snippet: String?
}

extension AppModel {
    /// The reader just opened for a book with an audiobook: when the audiobook is
    /// the more recent one, matches its position into the ebook. `stored` is the
    /// reading position the reader opened from, read before the reader's own
    /// saves move its timestamp. Nil when there is nothing worth showing.
    func suggestEbookSpot(
        bookId: Int,
        stored: ReadingPosition?,
        openedSpinePath: String?,
        openedProgression: Double?
    ) async -> HandoffSuggestionBanner? {
        guard isOnline, let client = api(),
              let audiobookEditionId = library.first(where: { $0.bookId == bookId })?.audiobookEditionId,
              let listen = await listeningPoint(editionId: audiobookEditionId),
              HandoffSuggestion.shouldCheckEbook(
                  listenAtMillis: listen.atMillis,
                  listenPositionSecs: listen.positionSecs,
                  readAtMillis: stored?.updatedAtMillis,
                  agreedAtMillis: handoffAgreedAtMillis[bookId]
              ),
              !Task.isCancelled
        else { return nil }

        let key = HandoffSuggestion.memoKey(bookId: bookId, listenPositionSecs: listen.positionSecs)
        guard handoffChecked.insert(key).inserted else { return nil }

        let spot: BookHandoff.EbookSpot
        do {
            spot = try await client.handoffToEbook(bookId: bookId, positionSecs: listen.positionSecs)
        } catch {
            Log.network.error("handoff suggestion failed: \(String(describing: error), privacy: .public)")
            return nil
        }
        guard !Task.isCancelled,
              HandoffSuggestion.isMeaningfullyDifferent(
                  openedSpinePath: openedSpinePath,
                  openedProgression: openedProgression,
                  matchedSpinePath: spot.spinePath,
                  matchedProgression: spot.progression
              )
        else { return nil }
        return HandoffSuggestionBanner(
            target: .ebook(spot),
            atMillis: listen.atMillis,
            snippet: HandoffSuggestion.snippet(fromLocatorJSON: spot.locatorJSON)
        )
    }

    /// The player just opened for a book with an ebook: when the ebook is the more
    /// recent one, matches its position into the audiobook.
    func suggestAudiobookSpot(bookId: Int, audiobookEditionId: Int) async -> HandoffSuggestionBanner? {
        guard isOnline, let client = api(),
              let ebookEditionId = library.first(where: { $0.bookId == bookId })?.ebookEditionId,
              let read = await readingPosition(editionId: ebookEditionId),
              !read.finished,
              !Task.isCancelled
        else { return nil }
        let listen = await listeningPoint(editionId: audiobookEditionId)
        guard HandoffSuggestion.shouldCheckAudiobook(
            readAtMillis: read.updatedAtMillis,
            listenAtMillis: listen?.atMillis,
            agreedAtMillis: handoffAgreedAtMillis[bookId]
        ) else { return nil }

        let key = HandoffSuggestion.memoKey(
            bookId: bookId, spinePath: read.spinePath, progression: read.scrollFraction
        )
        guard handoffChecked.insert(key).inserted else { return nil }

        let positionSecs: Double
        do {
            positionSecs = try await client.handoffToAudiobook(
                bookId: bookId, spinePath: read.spinePath, progression: read.scrollFraction
            )
        } catch {
            Log.network.error("handoff suggestion failed: \(String(describing: error), privacy: .public)")
            return nil
        }
        guard !Task.isCancelled,
              HandoffSuggestion.isMeaningfullyDifferent(
                  currentSecs: player.positionSecs, matchedSecs: positionSecs
              )
        else { return nil }
        return HandoffSuggestionBanner(
            target: .audiobook(positionSecs: positionSecs),
            atMillis: read.updatedAtMillis,
            snippet: nil
        )
    }

    /// The listening position and when it was recorded: the newer of this
    /// device's journal and the server's row.
    private func listeningPoint(editionId: Int) async -> (positionSecs: Double, atMillis: Int64)? {
        var best = await journalEntries()[editionId].map { (positionSecs: $0.positionSecs, atMillis: $0.atMillis) }
        if let apiClient,
           let remote = await withDeadline(seconds: 5, { try? await apiClient.getProgress() })?
           .first(where: { $0.editionId == editionId })
        {
            let remoteMillis = Int64(remote.updatedAt.timeIntervalSince1970 * 1000)
            if remoteMillis > (best?.atMillis ?? .min) {
                best = (remote.positionSecs, remoteMillis)
            }
        }
        return best
    }

    /// The two formats now sit at the same spot, so neither should suggest the other.
    func noteHandoffAgreed(bookId: Int) {
        handoffAgreedAtMillis[bookId] = Int64(Date().timeIntervalSince1970 * 1000)
    }
}
