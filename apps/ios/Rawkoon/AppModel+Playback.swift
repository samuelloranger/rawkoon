import Foundation
import RawkoonKit

extension AppModel {
    /// The book currently loaded in the player, if any — drives the persistent
    /// mini-player and its expand-to-full-player sheet. Non-nil once
    /// `openPlayer(editionId:)` has run (it caches the manifest and sets
    /// `activeEditionId`).
    func activeBook() -> (summary: LibrarySummary, manifest: BookManifest)? {
        guard
            let id = activeEditionId,
            let summary = libraryStore.library.first(where: { $0.audiobookEditionId == id })?.audiobookSummary,
            let manifest = downloads.manifests[id]
        else {
            return nil
        }
        return (summary, manifest)
    }

    func openPlayer(editionId: Int, resumeAt overridePosition: Double? = nil) async {
        session.errorMessage = nil

        // Reloading the book already playing would pause it and rewind it to a
        // stale snapshot, so only an explicitly chosen position moves it.
        if editionId == activeEditionId, player.manifest?.editionId == editionId, player.playbackError == nil {
            if let overridePosition {
                player.seek(to: overridePosition)
            }
            return
        }

        do {
            let manifest = try await downloads.manifest(editionId)
            guard let baseURL = URL(string: session.serverURL) else {
                session.errorMessage = String(localized: "Enter a valid server URL.")
                return
            }

            let resumeAt: Double = if let overridePosition {
                max(0, min(overridePosition, manifest.totalDurationSecs))
            } else {
                await resolveResumePosition(editionId: editionId, manifest: manifest)
            }
            persistPlaybackProgress(force: true)
            activeEditionId = editionId
            player.load(
                manifest: manifest,
                baseURL: baseURL,
                resumeAt: resumeAt,
                artworkURL: libraryStore.library
                    .first(where: { $0.audiobookEditionId == editionId })?
                    .audiobookSummary?.coverURL
            )
            // The manifest may be a cached copy whose signed URLs expired after
            // seven days; refresh them behind playback for any chapter that streams.
            Task { [weak self] in
                guard let fresh = await self?.downloads.refreshedManifest(editionId: editionId) else { return }
                self?.player.adoptRefreshedManifest(fresh)
            }
        } catch {
            session.errorMessage = message(for: error)
        }
    }

    /// Closes the player: stops audio, drops Now Playing, hides the mini bar.
    func closePlayer() {
        persistPlaybackProgress(force: true)
        activeEditionId = nil
        player.unload()
    }
}
