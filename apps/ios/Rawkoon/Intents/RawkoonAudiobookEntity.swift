import AppIntents

/// A single audiobook, addressable by Siri, Shortcuts, and Spotlight. The id is
/// the audiobook edition id — stable across launches and the same value the
/// player loads — so a saved shortcut keeps resolving to the right book.
struct RawkoonAudiobookEntity: AppEntity {
    let id: Int
    let title: String
    let author: String?

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audiobook")

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title)",
            subtitle: author.map { "\($0)" }
        )
    }

    static let defaultQuery = RawkoonAudiobookQuery()
}

/// Pure resolution over a library snapshot, so entity selection is testable
/// without the App Intents runtime or a live model. Signed out resolves to
/// nothing — the library is private and must never leak into system search.
enum AudiobookCatalog {
    nonisolated static func all(in library: [BookListItem], isLoggedIn: Bool) -> [RawkoonAudiobookEntity] {
        guard isLoggedIn else { return [] }
        return library.compactMap { item in
            guard let editionId = item.audiobookEditionId else { return nil }
            return RawkoonAudiobookEntity(id: editionId, title: item.title, author: item.author)
        }
    }

    nonisolated static func entities(
        for ids: [Int],
        in library: [BookListItem],
        isLoggedIn: Bool
    ) -> [RawkoonAudiobookEntity] {
        let wanted = Set(ids)
        return all(in: library, isLoggedIn: isLoggedIn).filter { wanted.contains($0.id) }
    }
}

/// Bridges the pure catalog to the live `AppModel`, loading the library on
/// demand so a cold Shortcuts/Siri invocation still resolves.
struct RawkoonAudiobookQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [Int]) async -> [RawkoonAudiobookEntity] {
        let model = AppModel.shared
        await ensureLibrary(model)
        return AudiobookCatalog.entities(for: identifiers, in: model.library, isLoggedIn: model.isLoggedIn)
    }

    @MainActor
    func suggestedEntities() async -> [RawkoonAudiobookEntity] {
        let model = AppModel.shared
        await ensureLibrary(model)
        return AudiobookCatalog.all(in: model.library, isLoggedIn: model.isLoggedIn)
    }

    @MainActor
    private func ensureLibrary(_ model: AppModel) async {
        if model.isLoggedIn, model.library.isEmpty {
            await model.loadLibrary()
        }
    }
}
