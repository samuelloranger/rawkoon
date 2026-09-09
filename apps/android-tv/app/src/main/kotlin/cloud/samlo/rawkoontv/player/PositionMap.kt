package cloud.samlo.rawkoontv.player

import cloud.samlo.rawkoontv.data.FileDto

data class ItemPosition(val itemIndex: Int, val offsetInItemSecs: Double)

// Maps the whole-book position to a (media item, in-item offset) and back. The
// media item is a physical FILE, so a single-file audiobook is one item whose
// in-item offset equals the whole-book position. For a multi-file book each
// file spans one chapter, so this matches the old per-chapter behavior.
class PositionMap(filesIn: List<FileDto>) {
    private val files = filesIn.sortedBy { it.startSecs }
    val totalSecs: Double =
        files.lastOrNull()?.let { it.startSecs + it.durationSecs } ?: 0.0

    fun toGlobal(itemIndex: Int, offsetInItemSecs: Double): Double =
        (files.getOrNull(itemIndex)?.startSecs ?: 0.0) + offsetInItemSecs

    fun toItem(globalSecs: Double): ItemPosition {
        if (files.isEmpty()) return ItemPosition(0, 0.0)
        if (globalSecs <= 0.0) return ItemPosition(0, 0.0)
        if (globalSecs >= totalSecs) return ItemPosition(files.lastIndex, files.last().durationSecs)
        var i = 0
        while (i < files.lastIndex && globalSecs >= files[i + 1].startSecs) i++
        return ItemPosition(i, globalSecs - files[i].startSecs)
    }
}
