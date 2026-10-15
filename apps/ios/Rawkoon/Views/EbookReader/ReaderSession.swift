import RawkoonKit
@preconcurrency import ReadiumNavigator
@preconcurrency import ReadiumShared
import SwiftUI

typealias EPUBLink = ReadiumShared.Link

enum ReaderState {
    case opening
    case ready(ReaderSession)
    case failed(String)

    /// The visible state without the session, so a crossfade can key on it.
    var phase: ReaderPhase {
        switch self {
        case .opening: .opening
        case .ready: .ready
        case .failed: .failed
        }
    }
}

enum ReaderPhase: Equatable {
    case opening, ready, failed
}

/// Observable chrome so the footer and TOC highlight refresh when the
/// navigator reports a new locator. The session itself is not observed.
@MainActor
@Observable
final class ReaderChrome {
    var currentLocator: Locator?
    var percent: Double?
}

@MainActor
final class ReaderSession {
    let publication: Publication
    let host: ReaderViewController
    let tableOfContents: [EPUBLink]
    private var lastPersistMillis: Int64 = 0
    private var currentLocator: Locator?
    private let editionId: Int?
    private let fileId: Int
    private let save: (ReadingPosition) -> Void

    var navigator: EPUBNavigatorViewController {
        host.navigator
    }

    init(
        publication: Publication,
        host: ReaderViewController,
        tableOfContents: [EPUBLink],
        editionId: Int?,
        fileId: Int,
        save: @escaping (ReadingPosition) -> Void
    ) {
        self.publication = publication
        self.host = host
        self.tableOfContents = tableOfContents
        self.editionId = editionId
        self.fileId = fileId
        self.save = save
    }

    func handleLocationChange(_ locator: Locator) {
        currentLocator = locator
        persist(force: false)
    }

    func persist(force: Bool) {
        guard let editionId else { return }
        guard let locator = currentLocator ?? navigator.currentLocation else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        if !force, now - lastPersistMillis < 3000 {
            return
        }
        lastPersistMillis = now
        save(position(from: locator, editionId: editionId, now: now))
    }

    /// Where the reader is, in the form the server's handoff matcher takes.
    func currentSpot() -> (spinePath: String, progression: Double)? {
        guard let locator = currentLocator ?? navigator.currentLocation else { return nil }
        return (spine(for: locator).path, locator.locations.progression ?? 0)
    }

    private func spine(for locator: Locator) -> (index: Int, path: String) {
        // Unknown to the reading order: report the locator's own href, not spine item 0's.
        guard let index = publication.readingOrder.firstIndexWithHREF(locator.href),
              publication.readingOrder.indices.contains(index)
        else { return (0, locator.href.string) }
        return (index, publication.readingOrder[index].href)
    }

    private func position(from locator: Locator, editionId: Int, now: Int64) -> ReadingPosition {
        let (index, spinePath) = spine(for: locator)
        return ReadingPosition(
            editionId: editionId,
            fileId: fileId,
            spineIndex: index,
            spinePath: spinePath,
            spineCount: publication.readingOrder.count,
            scrollFraction: locator.locations.progression ?? 0,
            finished: (locator.locations.totalProgression ?? 0) >= 0.99,
            updatedAtMillis: now,
            locator: try? locator.jsonString()
        )
    }
}
