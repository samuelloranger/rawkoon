import Foundation
import UIKit
import WidgetKit

/// Mirrors the already-loaded Home feeds into the WidgetKit App Group.
/// Artwork is downsampled before sharing; credentials remain in the app Keychain.
@MainActor
final class WidgetSnapshotWriter {
    static let shared = WidgetSnapshotWriter()
    private var generation = 0

    private init() {}

    func clear() {
        generation += 1
        WidgetSnapshotStore.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }

    func updateListening(_ stats: ListeningStats?) {
        var snapshot = WidgetSnapshotStore.read()
        snapshot.listening = stats.map {
            WidgetListening(
                weekSeconds: $0.weekSecs,
                todaySeconds: $0.todaySecs,
                days: $0.week.map(\.seconds)
            )
        }
        save(snapshot)
    }

    func updateRecent(_ items: [LibraryMedia], model: AppModel) async {
        let current = generation
        let cached = Dictionary(
            WidgetSnapshotStore.read().recent.compactMap { media in media.artworkKey.map { ($0, media.artwork) } },
            uniquingKeysWith: { first, _ in first }
        )
        var media: [WidgetMedia] = []
        for item in items.prefix(3) {
            let detail = item.type == "show" ? String(localized: "Series") : String(localized: "Movie")
            let url = model.absoluteURL(item.posterUrl)
            let key = url?.absoluteString
            let data: Data? = if let key, let hit = cached[key] ?? nil {
                hit
            } else {
                await artwork(for: url, serverURL: model.serverURL)
            }
            media.append(WidgetMedia(title: item.title, detail: detail, artwork: data, artworkKey: key))
        }
        guard current == generation, model.isLoggedIn else { return }
        var snapshot = WidgetSnapshotStore.read()
        snapshot.recent = media
        save(snapshot)
    }

    func updateSuggestion(_ deck: DiscoverDeckResponse?, model: AppModel) async {
        let current = generation
        let today = Calendar.current.startOfDay(for: Date())
        let previous = WidgetSnapshotStore.read()
        if previous.suggestion != nil, previous.suggestionDay == today {
            return
        }
        let suggestion: WidgetSuggestion?
        if let deck, let first = deck.items.first {
            let detail = first.mediaType == "tv" ? String(localized: "Series") : String(localized: "Movie")
            suggestion = await WidgetSuggestion(
                media: WidgetMedia(
                    title: first.title,
                    detail: detail,
                    artwork: artwork(for: model.absoluteURL(first.posterUrl), serverURL: model.serverURL),
                    artworkKey: model.absoluteURL(first.posterUrl)?.absoluteString
                ),
                personalized: deck.source == .personalized
            )
        } else {
            suggestion = nil
        }
        guard current == generation, model.isLoggedIn else { return }
        var snapshot = WidgetSnapshotStore.read()
        snapshot.suggestion = suggestion
        snapshot.suggestionDay = suggestion == nil ? nil : today
        save(snapshot)
    }

    private func save(_ snapshot: WidgetSnapshot) {
        var next = snapshot
        next.updatedAt = Date()
        if WidgetSnapshotStore.write(next) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private func artwork(for url: URL?, serverURL: String) async -> Data? {
        guard let url, url.scheme == "https" || url.scheme == "http" else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 7
        if url.host == URL(string: serverURL)?.host,
           let token = Keychain.get(AppModel.authTokenKey)
        {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              data.count < 3_000_000,
              let image = UIImage(data: data)
        else { return nil }
        let size = CGSize(width: 90, height: 135)
        let rendered = UIGraphicsImageRenderer(size: size).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return rendered.jpegData(compressionQuality: 0.7)
    }
}
