package cloud.samlo.rawkoontv.player

import cloud.samlo.rawkoontv.data.ChapterDto

// Chapters as timeline markers over the whole-book position, decoupled from the
// media items (files). Titles and the current-chapter ordinal for the UI come
// from here, and chapter navigation seeks to these boundaries — so a single-file
// audiobook still shows and steps through its chapters.
class ChapterMarks(chaptersIn: List<ChapterDto>) {
    val chapters = chaptersIn.sortedBy { it.index }
    val titles = chapters.map { it.title }

    // Ordinal (position in `chapters`/`titles`) of the chapter containing the
    // position — the last chapter that has started. Half-open by start, matching
    // the players on the other platforms.
    fun ordinalAt(globalSecs: Double): Int {
        val idx = chapters.indexOfLast { globalSecs >= it.startSecs }
        return if (idx < 0) 0 else idx
    }

    fun startOfOrdinal(ordinal: Int): Double =
        chapters.getOrNull(ordinal)?.startSecs ?: 0.0

    fun nextBoundaryAfter(globalSecs: Double): Double? =
        chapters.firstOrNull { it.startSecs > globalSecs }?.startSecs

    fun prevBoundaryBefore(globalSecs: Double): Double? =
        chapters.lastOrNull { it.startSecs < globalSecs }?.startSecs
}
