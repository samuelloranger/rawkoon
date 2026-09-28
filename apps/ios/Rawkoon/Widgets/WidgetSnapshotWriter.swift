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
        for item in items.prefix(6) {
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

    /// Draws a fresh pool of library titles once a day; the widget rotates through it every six hours.
    func updateWatch(model: AppModel) async {
        let current = generation
        let previous = WidgetSnapshotStore.read()
        if let pool = previous.watch, !pool.isEmpty,
           let rolled = previous.watchRolledAt, Date().timeIntervalSince(rolled) < 24 * 60 * 60
        {
            return
        }
        guard let client = model.api(), let head = try? await client.libraryList(page: 1, limit: 1) else { return }
        let total = (head.movieCount ?? 0) + (head.showCount ?? 0)
        var picks: [WidgetWatchPick] = []
        // One-item pages at random offsets: the list API has no random order.
        for index in Array(0 ..< total).shuffled().prefix(16) {
            guard picks.count < 4 else { break }
            guard let item = try? await client.libraryList(page: index + 1, limit: 1).items.first,
                  item.status == "downloaded" || item.status == "upgrading" || (item.downloadedEpisodeCount ?? 0) > 0
            else { continue }
            let kind = item.type == "show" ? String(localized: "Series") : String(localized: "Movie")
            let url = model.absoluteURL(item.backdropUrl ?? item.posterUrl)
            await picks.append(WidgetWatchPick(
                libraryId: item.id,
                tmdbId: item.tmdbId,
                mediaType: item.type == "show" ? "tv" : "movie",
                media: WidgetMedia(
                    title: item.title,
                    detail: item.year.map { "\($0) · \(kind)" } ?? kind,
                    artwork: artwork(
                        for: url, serverURL: model.serverURL,
                        size: CGSize(width: 364, height: 205), scale: 1.5, quality: 0.6
                    ),
                    artworkKey: url?.absoluteString
                )
            ))
        }
        guard current == generation, model.isLoggedIn else { return }
        var snapshot = WidgetSnapshotStore.read()
        snapshot.watch = picks
        snapshot.watchRolledAt = picks.isEmpty ? nil : Date()
        save(snapshot)
    }

    private func save(_ snapshot: WidgetSnapshot) {
        var next = snapshot
        next.updatedAt = Date()
        if WidgetSnapshotStore.write(next) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private func artwork(
        for url: URL?, serverURL: String, size: CGSize = CGSize(width: 90, height: 135),
        scale _: CGFloat = 2, quality: CGFloat = 0.7
    ) async -> Data? {
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
        // Aspect-fill crop, so a backdrop drawn into a poster frame (or the reverse) is never squashed.
        let scale = max(size.width / image.size.width, size.height / image.size.height)
        let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let origin = CGPoint(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2)
        // Below the screen's 3x keeps the shared snapshot small; widget artwork never needs it.
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: origin, size: drawn))
        }
        return rendered.jpegData(compressionQuality: quality)
    }
}
