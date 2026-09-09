package cloud.samlo.rawkoontv.player

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import cloud.samlo.rawkoontv.data.ManifestDto
import cloud.samlo.rawkoontv.data.RawkoonApi
import cloud.samlo.rawkoontv.data.playbackFiles
import com.google.common.util.concurrent.MoreExecutors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class PlayerUiState(
    val chapterTitle: String = "",
    val globalSecs: Double = 0.0,
    val totalSecs: Double = 0.0,
    val isPlaying: Boolean = false,
    val chapters: List<String> = emptyList(),
    val currentChapterIndex: Int = 0,
    val speed: Float = 1f,
    val sleepMinutes: Int? = null, // selected preset, null = off
    val sleepRemainingSecs: Int? = null, // live countdown, null = off
)

class PlaybackController(
    private val context: Context,
    private val api: RawkoonApi,
    private val scope: CoroutineScope,
) {
    private var controller: MediaController? = null
    private var map: PositionMap? = null
    private var marks: ChapterMarks? = null
    private var editionId: Int = -1
    private var totalSecs: Double = 0.0
    private val gate = SyncGate()
    // Own IO scope so progress writes survive composition disposal (e.g. Back).
    private val ioScope = CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.IO)
    // Block saves during open/seek so the transient position 0 can't clobber saved progress.
    @Volatile private var suppressSaves = true
    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state

    suspend fun open(editionId: Int, resumeGlobalSecs: Double, baseUrl: String) {
        this.editionId = editionId
        suppressSaves = true
        val manifest: ManifestDto = api.manifest(editionId)
        map = PositionMap(manifest.playbackFiles())
        marks = ChapterMarks(manifest.chapters)
        totalSecs = map!!.totalSecs
        // Authoritative resume point: the server's saved position (fresh),
        // falling back to the value the library passed in.
        val serverResume = runCatching {
            api.progress().firstOrNull { it.editionId == editionId && !it.finished }?.positionSecs
        }.getOrNull()
        val resumeAt = serverResume ?: resumeGlobalSecs
        val playlist = buildPlaylist(baseUrl, manifest)
        _state.value = _state.value.copy(chapters = marks!!.titles, totalSecs = totalSecs)
        val items = playlist.map { MediaItem.fromUri(it.mediaUri) }
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener({
            val c = future.get(); controller = c
            val alreadyLoaded = PlaybackState.loadedEditionId == editionId && c.mediaItemCount > 0
            if (alreadyLoaded) {
                // Same book already playing in the service — reconnect seamlessly,
                // no setMediaItems/seek (that's what caused the audio cut).
                _state.value = _state.value.copy(isPlaying = c.isPlaying)
                attachListener(c)
                startTicker()
                suppressSaves = false
            } else {
                c.setMediaItems(items)
                val pos = map!!.toItem(resumeAt)
                c.prepare(); c.seekTo(pos.itemIndex, (pos.offsetInItemSecs * 1000).toLong())
                c.play()
                PlaybackState.loadedEditionId = editionId
                attachListener(c)
                startTicker()
                // Let the seek settle before allowing saves, so the transient 0 doesn't clobber.
                ioScope.launch { kotlinx.coroutines.delay(1500); suppressSaves = false }
            }
        }, MoreExecutors.directExecutor())
    }

    private fun attachListener(c: MediaController) {
        c.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _state.value = _state.value.copy(isPlaying = isPlaying)
                if (!isPlaying) writeProgress(force = true)
            }
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                writeProgress(force = true)
            }
        })
    }

    private fun currentGlobal(): Double {
        val c = controller ?: return 0.0
        val m = map ?: return 0.0
        return m.toGlobal(c.currentMediaItemIndex, c.currentPosition / 1000.0)
    }

    private fun writeProgress(force: Boolean) {
        if (suppressSaves) return
        val g = currentGlobal()
        if (gate.shouldWrite(System.currentTimeMillis(), g, force)) {
            val finished = totalSecs > 0 && g >= totalSecs - 5.0
            ioScope.launch {
                runCatching { api.putProgress(editionId, g, totalSecs, finished) }
                    .onFailure { android.util.Log.e("RawkoonPlay", "save failed", it) }
            }
        }
    }

    private fun startTicker() {
        scope.launch {
            while (controller != null) {
                controller ?: break
                val g = currentGlobal()
                val remaining = sleepEndMs?.let {
                    ((it - System.currentTimeMillis()) / 1000).toInt().coerceAtLeast(0)
                }
                // Marker from the whole-book position, not the media item: one
                // file can span many chapters (single-file audiobook).
                val ordinal = marks?.ordinalAt(g) ?: 0
                _state.value = _state.value.copy(
                    globalSecs = g, totalSecs = totalSecs,
                    currentChapterIndex = ordinal,
                    chapterTitle = _state.value.chapters.getOrNull(ordinal) ?: "",
                    sleepRemainingSecs = remaining,
                )
                writeProgress(force = false)
                delay(1000)
            }
        }
    }

    fun playPause() { controller?.let { if (it.isPlaying) it.pause() else it.play() } }
    fun skip(deltaSecs: Double) = seekGlobal(currentGlobal() + deltaSecs)
    // Chapter navigation seeks to chapter BOUNDARIES on the whole-book timeline,
    // not to media items — one media item can hold many chapters (single-file).
    fun nextChapter() {
        val next = marks?.nextBoundaryAfter(currentGlobal()) ?: return
        seekGlobal(next)
    }
    fun prevChapter() {
        seekGlobal(marks?.prevBoundaryBefore(currentGlobal()) ?: 0.0)
    }
    fun seekGlobal(secs: Double) {
        val m = map ?: return; val c = controller ?: return
        val p = m.toItem(secs)
        c.seekTo(p.itemIndex, (p.offsetInItemSecs * 1000).toLong())
        writeProgress(true)
    }

    fun jumpToChapter(index: Int) {
        val m = marks ?: return
        seekGlobal(m.startOfOrdinal(index))
    }

    private val speeds = listOf(1f, 1.25f, 1.5f, 1.75f, 2f)
    fun cycleSpeed() {
        val next = speeds[(speeds.indexOf(_state.value.speed).coerceAtLeast(0) + 1) % speeds.size]
        controller?.setPlaybackSpeed(next)
        _state.value = _state.value.copy(speed = next)
    }

    private val sleepOptions = listOf<Int?>(null, 15, 30, 45, 60)
    private var sleepJob: kotlinx.coroutines.Job? = null
    private var sleepEndMs: Long? = null
    fun cycleSleep() {
        val next = sleepOptions[(sleepOptions.indexOf(_state.value.sleepMinutes).coerceAtLeast(0) + 1) % sleepOptions.size]
        sleepJob?.cancel()
        if (next == null) {
            sleepEndMs = null
            _state.value = _state.value.copy(sleepMinutes = null, sleepRemainingSecs = null)
        } else {
            sleepEndMs = System.currentTimeMillis() + next * 60_000L
            _state.value = _state.value.copy(sleepMinutes = next, sleepRemainingSecs = next * 60)
            sleepJob = scope.launch {
                delay(next * 60_000L)
                controller?.pause()
                sleepEndMs = null
                _state.value = _state.value.copy(sleepMinutes = null, sleepRemainingSecs = null)
            }
        }
    }

    fun release() {
        writeProgress(force = true) // persist position before tearing down (e.g. on Back)
        controller?.release(); controller = null
    }
}
