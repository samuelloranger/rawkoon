package cloud.samlo.rawkoontv.player

import cloud.samlo.rawkoontv.data.ChapterDto
import cloud.samlo.rawkoontv.data.FileDto
import cloud.samlo.rawkoontv.data.ManifestDto
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaylistTest {
    @Test fun multiFileOneItemPerFileResolvingUrls() {
        val m = ManifestDto(
            200.0,
            chapters = listOf(
                ChapterDto(1, "B", 100.0, 200.0, 2, "/api/books/files/2/content?grant=y"),
                ChapterDto(0, "A", 0.0, 100.0, 1, "/api/books/files/1/content?grant=x"),
            ),
            files = listOf(
                FileDto(1, 0.0, 100.0, "/api/books/files/1/content?grant=x"),
                FileDto(2, 100.0, 100.0, "/api/books/files/2/content?grant=y"),
            ),
        )
        val items = buildPlaylist("https://s.tld", m)
        assertEquals(listOf(1, 2), items.map { it.fileId })
        assertEquals("https://s.tld/api/books/files/1/content?grant=x", items[0].mediaUri)
    }

    // Single-file audiobook: 82 chapters, one file -> exactly one media item.
    @Test fun singleFileCollapsesToOneItem() {
        val m = ManifestDto(
            410.0,
            chapters = (0 until 82).map {
                ChapterDto(it, "C$it", it * 5.0, it * 5.0 + 5, 9, "/api/books/files/9/content?grant=z")
            },
            files = listOf(FileDto(9, 0.0, 410.0, "/api/books/files/9/content?grant=z")),
        )
        val items = buildPlaylist("https://s.tld", m)
        assertEquals(1, items.size)
        assertEquals(9, items[0].fileId)
    }

    // A manifest that predates files[] synthesizes one file per chapter.
    @Test fun legacyManifestWithoutFilesSynthesizesPerChapter() {
        val m = ManifestDto(
            200.0,
            chapters = listOf(
                ChapterDto(0, "A", 0.0, 100.0, 1, "/f/1"),
                ChapterDto(1, "B", 100.0, 200.0, 2, "/f/2"),
            ),
        )
        val items = buildPlaylist("https://s.tld", m)
        assertEquals(listOf(1, 2), items.map { it.fileId })
    }
}
