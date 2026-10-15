import RawkoonKit
@preconcurrency import ReadiumNavigator
@preconcurrency import ReadiumShared
@preconcurrency import ReadiumStreamer
import SwiftUI

extension EbookReaderSheet {
    /// Asset → Publication through the streamer. EPUB-only in this slice.
    static func openPublication(at url: URL) async throws -> Publication {
        guard let fileURL = FileURL(url: url) else {
            throw OpenError.notAFile
        }
        let httpClient = DefaultHTTPClient()
        let assetRetriever = AssetRetriever(httpClient: httpClient)
        let opener = PublicationOpener(parser: EPUBParser())
        let asset = try await assetRetriever.retrieve(url: fileURL).get()
        return try await opener.open(asset: asset, allowUserInteraction: false).get()
    }

    /// Prefer a stored Locator JSON if it still parses; otherwise the coarse
    /// spine path/index via `ReadingProgressReconciler.resolve`.
    static func resumeLocator(
        publication: Publication,
        stored: ReadingPosition?
    ) async -> Locator? {
        if let json = stored?.locator,
           let usable = readingOrderLocatorJSON(json, publication: publication),
           let locator = try? Locator(jsonString: usable)
        {
            return publication.normalizeLocator(locator)
        }
        guard let stored else { return nil }
        let spine = publication.readingOrder.map(\.href)
        let resolved = ReadingProgressReconciler.resolve(stored, spine: spine)
        return await locator(at: resolved.index, progression: resolved.scrollFraction, in: publication)
    }

    /// A handed-off locator carries an OPF-relative href that Readium cannot map;
    /// point it at the matching reading-order entry. Nil when no entry matches
    /// uniquely, so the caller falls back to the stored spine index.
    static func readingOrderLocatorJSON(_ json: String, publication: Publication) -> String? {
        guard let href = BookHandoff.locatorHref(json) else { return json }
        let spine = publication.readingOrder.map(\.href)
        if spine.contains(href) { return json }
        guard let matched = BookHandoff.matchReadingOrderHref(href, in: spine) else { return nil }
        return BookHandoff.locatorJSON(json, withHref: matched)
    }

    static func locator(
        at index: Int,
        progression: Double,
        in publication: Publication
    ) async -> Locator? {
        guard publication.readingOrder.indices.contains(index) else { return nil }
        let link = publication.readingOrder[index]
        if let located = await publication.locate(link) {
            return located.copy(locations: { $0.progression = progression })
        }
        return Locator(
            href: link.url(),
            mediaType: link.mediaType ?? .xhtml,
            title: link.title,
            locations: Locator.Locations(progression: progression)
        )
    }

    static func loadTableOfContents(_ publication: Publication) async -> [EPUBLink] {
        let loaded = await (try? publication.tableOfContents().get()) ?? []
        return loaded.isEmpty ? publication.readingOrder : loaded
    }

    static func describe(_ error: Error) -> String {
        if error is OpenError {
            return String(localized: "The book file is missing from disk.")
        }
        if let open = error as? PublicationOpenError {
            switch open {
            case .formatNotSupported:
                return String(localized: "This file is not a supported EPUB.")
            case .reading:
                return error.localizedDescription
            }
        }
        if let retrieve = error as? AssetRetrieveURLError {
            switch retrieve {
            case .formatNotSupported:
                return String(localized: "This file is not a supported EPUB.")
            case .schemeNotSupported:
                return String(localized: "Could not open the file from this location.")
            case .reading:
                return error.localizedDescription
            }
        }
        if let epubError = error as? EPUBNavigatorViewController.EPUBError,
           case .publicationRestricted = epubError
        {
            return String(localized: "This publication is locked and cannot be opened.")
        }
        return error.localizedDescription
    }

    enum OpenError: Error {
        case notAFile
    }
}
