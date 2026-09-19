import Foundation
import MediaPlayer
import RawkoonKit
import UIKit

/// Now Playing info center updates and lock-screen artwork loading. Split out
/// of AudiobookPlayer.swift; behavior unchanged.
extension AudiobookPlayer {
    func updateNowPlayingInfo() {
        guard let manifest else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = currentChapter?.title ?? manifest.title
        info[MPMediaItemPropertyAlbumTitle] = manifest.title
        info[MPMediaItemPropertyArtist] = manifest.authors.joined(separator: ", ")
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionSecs
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0
        // Tells the system this book's normal speed is the listener's chosen
        // rate, not 1.0, so a rate control on the Lock Screen or in a car reads
        // against the right baseline.
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = rate
        if !chapters.isEmpty {
            info[MPNowPlayingInfoPropertyChapterCount] = chapters.count
            // Chapter numbering is zero-based and contiguous, which
            // `ManifestChapter.index` is only in practice — `BookTimeline`
            // treats it as a domain id and allows gaps. Send the ordinal.
            if let index = currentChapterIndex,
               let ordinal = chapters.firstIndex(where: { $0.index == index })
            {
                info[MPNowPlayingInfoPropertyChapterNumber] = ordinal
            }
        }
        if let artwork {
            info[MPMediaItemPropertyArtwork] = artwork
        } else {
            info.removeValue(forKey: MPMediaItemPropertyArtwork)
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// Fetches the cover for the Lock Screen, Control Center and CarPlay.
    ///
    /// `MPMediaItemArtwork` wants a `UIImage`, not a URL, so nothing shows
    /// until the bytes are in hand — which is why Now Playing was blank while
    /// the same cover rendered fine in-app through `AsyncImage`.
    func loadArtwork(from url: URL?) {
        guard url != artworkURL || (url != nil && artwork == nil) else { return }
        artworkTask?.cancel()
        artworkTask = nil
        artworkURL = url
        artwork = nil
        guard let url else { return }

        artworkTask = Task { [weak self] in
            let data: Data
            do {
                (data, _) = try await URLSession.shared.data(from: url)
            } catch {
                Log.playback.error(
                    """
                    Artwork fetch failed: \
                    error=\(error.localizedDescription, privacy: .public)
                    """
                )
                return
            }
            guard
                !Task.isCancelled,
                let image = UIImage(data: data)
            else { return }
            await MainActor.run {
                guard let self, self.artworkURL == url else { return }
                self.artwork = Self.makeArtwork(image)
                self.updateNowPlayingInfo()
            }
        }
    }

    /// Builds the Now Playing artwork in a `nonisolated` context on purpose.
    ///
    /// `MPMediaItemArtwork`'s request handler is invoked by `MPNowPlayingInfoCenter`
    /// on MediaPlayer's own private queue, not the main actor. Created inside a
    /// `@MainActor` context, the closure inherits main-actor isolation, so under
    /// Swift 6 the runtime inserts an executor assertion that traps (EXC_BREAKPOINT)
    /// the moment MediaPlayer asks for the bitmap off-main — which crashed playback
    /// start as soon as Now Playing requested the cover. A `nonisolated` factory
    /// keeps the closure free of isolation; it only returns the captured `UIImage`
    /// (Sendable), so it is safe to call from any queue.
    private nonisolated static func makeArtwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }
}
