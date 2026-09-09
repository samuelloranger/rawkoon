package cloud.samlo.rawkoontv.player

import cloud.samlo.rawkoontv.data.ChapterDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChapterMarksTest {
    private fun ch(i: Int, start: Double, end: Double) = ChapterDto(i, "C$i", start, end, 0, "u")
    private val marks = ChapterMarks(listOf(ch(0, 0.0, 100.0), ch(1, 100.0, 200.0), ch(2, 200.0, 300.0)))

    @Test fun titlesInOrder() {
        assertEquals(listOf("C0", "C1", "C2"), marks.titles)
    }
    @Test fun ordinalAtMidChapter() {
        assertEquals(1, marks.ordinalAt(150.0))
    }
    @Test fun ordinalAtBoundaryStartsThatChapter() {
        assertEquals(1, marks.ordinalAt(100.0))
    }
    @Test fun ordinalBelowZeroIsFirst() {
        assertEquals(0, marks.ordinalAt(-5.0))
    }
    @Test fun nextBoundary() {
        assertEquals(200.0, marks.nextBoundaryAfter(150.0))
        assertNull(marks.nextBoundaryAfter(250.0))
    }
    @Test fun prevBoundary() {
        assertEquals(100.0, marks.prevBoundaryBefore(150.0))
        assertNull(marks.prevBoundaryBefore(0.0))
    }
    @Test fun startOfOrdinal() {
        assertEquals(200.0, marks.startOfOrdinal(2), 0.0)
    }
}
