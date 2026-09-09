package cloud.samlo.rawkoontv.player

import cloud.samlo.rawkoontv.data.ManifestDto
import cloud.samlo.rawkoontv.data.playbackFiles
import cloud.samlo.rawkoontv.data.resolveUrl

data class PlaylistItem(val mediaUri: String, val fileId: Int)

// One media item per physical FILE, not per chapter: a single-file audiobook is
// one item that many chapters index into (chapters are timeline markers). Files
// are already ordered by start; keep that as the media order.
fun buildPlaylist(baseUrl: String, manifest: ManifestDto): List<PlaylistItem> =
    manifest.playbackFiles().sortedBy { it.startSecs }.map { f ->
        PlaylistItem(
            mediaUri = resolveUrl(baseUrl, f.url) ?: f.url,
            fileId = f.id,
        )
    }
