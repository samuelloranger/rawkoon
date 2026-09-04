import CarPlay
import Foundation
import ImageIO
import RawkoonKit
import UIKit

/// Maps model state onto CarPlay templates. The pure sectioning is in
/// RawkoonKit (`CarPlayBrowse`); this file is the UIKit-bound glue and lives in
/// the app target because CarPlay types cannot compile on Linux CI.
enum CarPlayInterface {
    /// A shallow information template used for the logged-out / empty / error
    /// states. CarPlay audio apps may only use system templates.
    static func message(_ text: String, title: String) -> CPInformationTemplate {
        CPInformationTemplate(
            title: title,
            layout: .leading,
            items: [CPInformationItem(title: nil, detail: text)],
            actions: []
        )
    }

    /// Builds the two browse sections from already-loaded model state. Returns
    /// sections (not a whole template) so the delegate can `updateSections` an
    /// existing list in place — a background library refresh must not tear down
    /// a pushed Now Playing template. `onSelect` receives the tapped edition id.
    @MainActor
    static func browseSections(
        entries: [CarPlayBrowseEntry],
        model: AppModel,
        onSelect: @escaping (Int) -> Void
    ) -> [CPListSection] {
        let split = CarPlayBrowse.sections(entries: entries)
        // Guard against head-unit item limits / artwork memory: cap the library.
        let cappedLibrary = Array(split.library.prefix(200))

        func makeItem(_ entry: CarPlayBrowseEntry) -> CPListItem {
            let item = CPListItem(text: entry.title, detailText: entry.author)
            item.handler = { _, completion in
                onSelect(entry.editionId)
                completion()
            }
            loadArtwork(for: entry, into: item, model: model)
            return item
        }

        var sections: [CPListSection] = []
        if !split.continueListening.isEmpty {
            sections.append(
                CPListSection(
                    items: split.continueListening.map(makeItem),
                    header: String(localized: "Continue Listening"),
                    sectionIndexTitle: nil
                )
            )
        }
        sections.append(
            CPListSection(
                items: cappedLibrary.map(makeItem),
                header: String(localized: "Library"),
                sectionIndexTitle: nil
            )
        )
        return sections
    }

    /// Cover art is not lazy-loaded by CarPlay, so fetch and downsample off-main,
    /// then set the image back on the main actor — CarPlay reloads just that row.
    /// Downsampling matters: covers are full-resolution and CarPlay holds every
    /// list image in memory at once, so a raw-decode of a long library spikes it.
    @MainActor
    private static func loadArtwork(
        for entry: CarPlayBrowseEntry,
        into item: CPListItem,
        model: AppModel
    ) {
        guard
            let book = model.library.first(where: { $0.audiobookEditionId == entry.editionId }),
            let url = book.coverURL
        else { return }
        Task {
            guard
                let (data, _) = try? await URLSession.shared.data(from: url),
                let image = downsampled(data, maxPixelSize: 360)
            else { return }
            await MainActor.run { item.setImage(image) }
        }
    }

    /// Decodes `data` straight to a thumbnail no larger than `maxPixelSize` on its
    /// long edge (≈120pt at @3x), never allocating the full-size bitmap.
    private static func downsampled(_ data: Data, maxPixelSize: CGFloat) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return nil
        }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ] as CFDictionary
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
            return nil
        }
        return UIImage(cgImage: thumbnail)
    }
}
