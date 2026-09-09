package cloud.samlo.rawkoontv.player

import cloud.samlo.rawkoontv.data.FileDto
import org.junit.Assert.assertEquals
import org.junit.Test

class PositionMapTest {
    private fun f(start: Double, dur: Double, id: Int = 0) = FileDto(id, start, dur, "u$id")

    // Multi-file book: one 100s file per chapter.
    private val map = PositionMap(listOf(f(0.0, 100.0, 0), f(100.0, 100.0, 1), f(200.0, 100.0, 2)))

    @Test fun totalIsSumOfFileDurations() {
        assertEquals(300.0, map.totalSecs, 0.0)
    }
    @Test fun globalWithinSecondFile() {
        assertEquals(150.0, map.toGlobal(1, 50.0), 0.0)
    }
    @Test fun itemFromGlobalMidSecond() {
        val p = map.toItem(150.0)
        assertEquals(1, p.itemIndex)
        assertEquals(50.0, p.offsetInItemSecs, 0.0)
    }
    @Test fun globalAtExactBoundaryStartsNextItem() {
        val p = map.toItem(100.0)
        assertEquals(1, p.itemIndex)
        assertEquals(0.0, p.offsetInItemSecs, 0.0)
    }
    @Test fun clampsBelowZero() {
        val p = map.toItem(-5.0)
        assertEquals(0, p.itemIndex); assertEquals(0.0, p.offsetInItemSecs, 0.0)
    }
    @Test fun clampsAboveTotalToLastItemEnd() {
        val p = map.toItem(999.0)
        assertEquals(2, p.itemIndex); assertEquals(100.0, p.offsetInItemSecs, 0.0)
    }

    // Single-file audiobook: one file spans the whole book, so a mid-book
    // position is item 0 at the whole-book offset (the bug this fixes — the old
    // per-chapter map put it in the wrong 0-based segment).
    @Test fun singleFileMapsWholeBookToOneItem() {
        val single = PositionMap(listOf(f(0.0, 400.0, 9)))
        assertEquals(400.0, single.totalSecs, 0.0)
        val p = single.toItem(250.0)
        assertEquals(0, p.itemIndex)
        assertEquals(250.0, p.offsetInItemSecs, 0.0)
    }
}
