import CarPlay
import Foundation
import RawkoonKit

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

    /// Builds the two-section browse list from already-loaded model state.
    /// `entries` come from `AppModel.carPlayAudiobooks()`; `onSelect` receives
    /// the tapped edition id.
    @MainActor
    static func browseTemplate(
        entries: [CarPlayBrowseEntry],
        model: AppModel,
        onSelect: @escaping (Int) -> Void
    ) -> CPListTemplate {
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
                    header: "Continue Listening",
                    sectionIndexTitle: nil
                )
            )
        }
        sections.append(
            CPListSection(
                items: cappedLibrary.map(makeItem),
                header: "Library",
                sectionIndexTitle: nil
            )
        )
        return CPListTemplate(title: "Rawkoon", sections: sections)
    }

    /// Cover art is not lazy-loaded by CarPlay, so fetch off-main and set the
    /// image back on the main actor — CarPlay reloads just that row.
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
                let image = UIImage(data: data)
            else { return }
            await MainActor.run { item.setImage(image) }
        }
    }
}
