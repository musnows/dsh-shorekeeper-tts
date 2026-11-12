package dev.musnows.shorekeeper.companion

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONException
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.atomic.AtomicBoolean

enum class Tab { Home, Talk, Listen }

enum class Link { Sample, Connecting, Live }

data class SpeechLine(
    val id: Long,
    val hers: Boolean,
    val text: String,
    val sample: Boolean,
)

data class UiState(
    val tab: Tab = Tab.Home,
    val link: Link = Link.Sample,
    val serverUrl: String = ServerUrl.EMULATOR,
    val lines: List<SpeechLine> = emptyList(),
    val draft: String = "",
    val status: String = "本地示例。还没连上本机语音。",
    val voiceNote: String = "系统语音，不是守岸人音色",
    val lastSpoken: String = "",
    val speaking: Boolean = false,
    val holding: Boolean = false,
    val hour: Int = 12,
)

class CompanionViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val player = PcmPlayer()
    private val sampleVoice = SampleSpeaker(app)
    private val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    private val opening = SamplePresence.greeting(hour)

    private val _state = MutableStateFlow(
        UiState(
            serverUrl = prefs.getString(KEY_URL, ServerUrl.EMULATOR) ?: ServerUrl.EMULATOR,
            hour = hour,
            lastSpoken = opening,
        ),
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var socket: RealtimeSocket? = null
    private var generation = 0
    private var alive = true
    private var connectJob: Job? = null
    private var speakJob: Job? = null
    private var sampleEpoch = 0
    private var rate = 24000
    private var liveChunks = ArrayList<ByteArray>()
    private var lastPcm = ByteArray(0)
    private var audioStartedAt = 0L
    private var recordStop: AtomicBoolean? = null
    private var recordThread: Thread? = null

    @Volatile
    private var liveRecorder: AudioRecord? = null

    fun select(tab: Tab) {
        _state.update { it.copy(tab = tab) }
    }

    fun setUrl(value: String) {
        _state.update { it.copy(serverUrl = value.take(300)) }
    }

    fun usePreset(url: String) {
        if (_state.value.link != Link.Sample) return
        _state.update { it.copy(serverUrl = url) }
    }

    fun setDraft(value: String) {
        _state.update { it.copy(draft = value.take(2000)) }
    }

    fun note(message: String) {
        _state.update { it.copy(status = message) }
    }

    fun connect() {
        val current = _state.value
        if (current.link == Link.Connecting || current.link == Link.Live) return
        val url = ServerUrl.normalize(current.serverUrl)
        if (url == null) {
            _state.update { it.copy(status = "地址要写成 ws://主机:端口/ws。") }
            return
        }
        prefs.edit().putString(KEY_URL, url).apply()
        val gen = ++generation
        val sock = RealtimeSocket(url) { event ->
            viewModelScope.launch {
                if (!alive || gen != generation) return@launch
                onEvent(event)
            }
        }
        socket = sock
        _state.update {
            it.copy(link = Link.Connecting, serverUrl = url, status = "正在连本机语音…")
        }
        sock.connect()
        connectJob?.cancel()
        connectJob = viewModelScope.launch {
            delay(15_000)
            if (alive && gen == generation && _state.value.link == Link.Connecting) {
                failLink("等了太久，还没有守岸人音色。确认本机 INWORLD_API_KEY，以及 server.mjs 已运行。")
            }
        }
    }

    fun disconnect() {
        failLink("已断开。现在是本地示例。")
    }

    fun send() {
        val current = _state.value
        val text = current.draft.trim()
        if (text.isEmpty() || current.link == Link.Connecting) return
        _state.update { it.copy(draft = "") }
        if (current.link == Link.Live) {
            append(hers = false, text = text, sample = false)
            val payload = JSONObject().put("type", "text").put("text", text.take(2000)).toString()
            if (socket?.send(payload) != true) {
                failLink("这句话没有送出去。回到本地示例。")
                return
            }
            _state.update { it.copy(status = "她在听。") }
            return
        }
        val reply = SamplePresence.reply(text)
        append(hers = false, text = text, sample = true)
        append(hers = true, text = reply, sample = true)
        speakSample(reply)
    }

    fun hold(down: Boolean) {
        if (down) {
            startHold()
            return
        }
        val wasHolding = _state.value.holding
        stopHold()
        if (wasHolding && _state.value.link == Link.Live) {
            _state.update { it.copy(status = "已松手，等她说。") }
        }
    }

    fun playLast() {
        val current = _state.value
        if (current.link == Link.Live && lastPcm.isNotEmpty()) {
            sampleEpoch += 1
            sampleVoice.stop()
            player.play(rate, lastPcm)
            _state.update { it.copy(speaking = true, voiceNote = INWORLD_NOTE) }
            scheduleSpeakingEnd(lastPcm.size)
            return
        }
        if (current.link == Link.Live) {
            _state.update { it.copy(status = "这一句没有语音数据。") }
            return
        }
        if (current.lastSpoken.isNotBlank()) speakSample(current.lastSpoken)
    }

    fun stopSpeaking() {
        speakJob?.cancel()
        sampleEpoch += 1
        player.stop()
        sampleVoice.stop()
        if (_state.value.link == Link.Live) {
            socket?.send("""{"type":"cut"}""")
        }
        _state.update { it.copy(speaking = false) }
    }

    override fun onCleared() {
        alive = false
        generation += 1
        connectJob?.cancel()
        speakJob?.cancel()
        stopHold()
        val current = socket
        socket = null
        current?.close()
        player.release()
        sampleVoice.shutdown()
        super.onCleared()
    }

    private fun onEvent(event: SocketEvent) {
        when (event) {
            SocketEvent.Open -> {
                if (_state.value.link == Link.Connecting) {
                    _state.update { it.copy(status = "已连上，正在设置音色。") }
                }
            }
            is SocketEvent.Message -> onMessage(event.text)
            is SocketEvent.Failed -> failLink(explainFailure(event.message))
            SocketEvent.Closed -> {
                if (_state.value.link != Link.Sample) failLink("连接断了。回到本地示例。")
            }
        }
    }

    private fun onMessage(text: String) {
        val json = try {
            JSONObject(text)
        } catch (_: JSONException) {
            return
        }
        when (json.optString("type")) {
            "ready" -> {
                rate = json.optInt("rate", 24000).takeIf { it > 0 } ?: 24000
                connectJob?.cancel()
                _state.update {
                    it.copy(
                        link = Link.Live,
                        status = "实时语音已接上。这一路是守岸人音色。",
                        voiceNote = INWORLD_NOTE,
                    )
                }
            }
            "status" -> {
                val status = json.optString("text")
                if (status.isNotBlank()) _state.update { it.copy(status = status) }
            }
            "caption" -> onCaption(json.optString("role"), json.optString("text"))
            "audio" -> onAudio(json.optString("pcm"))
            "error" -> {
                val message = explainFailure(json.optString("message").ifBlank { "语音服务出错。" })
                if (_state.value.link != Link.Live) failLink(message)
                else _state.update { it.copy(status = message, speaking = false) }
            }
            "interrupt" -> {
                player.stop()
                liveChunks = ArrayList()
                _state.update { it.copy(speaking = false, status = "她停下来了。") }
            }
            "think" -> _state.update { it.copy(status = "她在查。") }
            "response-started" -> onResponseStarted()
            "response-done" -> onResponseDone()
        }
    }

    private fun onCaption(role: String, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        if (role == "her") {
            append(hers = true, text = clean, sample = false)
            _state.update { it.copy(lastSpoken = clean, voiceNote = INWORLD_NOTE) }
        } else {
            append(hers = false, text = clean, sample = false)
        }
    }

    private fun onAudio(encoded: String) {
        if (encoded.isEmpty()) return
        val bytes = try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            return
        }
        if (bytes.isEmpty()) return
        if (liveChunks.isEmpty()) audioStartedAt = SystemClock.elapsedRealtime()
        liveChunks.add(bytes)
        sampleEpoch += 1
        sampleVoice.stop()
        player.write(rate, bytes)
        _state.update { it.copy(speaking = true, voiceNote = INWORLD_NOTE) }
    }

    private fun onResponseStarted() {
        liveChunks = ArrayList()
        audioStartedAt = 0L
        sampleEpoch += 1
        sampleVoice.stop()
        player.stop()
        _state.update { it.copy(speaking = false, status = "她在说。") }
    }

    private fun onResponseDone() {
        val pcm = concat(liveChunks)
        if (pcm.isNotEmpty()) lastPcm = pcm
        val elapsed = if (audioStartedAt == 0L) 0L else SystemClock.elapsedRealtime() - audioStartedAt
        scheduleSpeakingEnd(pcm.size, elapsed)
    }

    private fun speakSample(text: String) {
        player.stop()
        val epoch = ++sampleEpoch
        val started = sampleVoice.speak(text) {
            if (!alive || epoch != sampleEpoch || _state.value.link == Link.Live) return@speak
            _state.update { it.copy(speaking = false) }
        }
        _state.update {
            it.copy(
                lastSpoken = text,
                speaking = started,
                voiceNote = if (started) {
                    SAMPLE_NOTE
                } else if (!sampleVoice.canSpeakChinese()) {
                    "这台手机没有可用的中文系统语音，只能看字。"
                } else {
                    "系统语音还没准备好。可以过一会儿再听。"
                },
            )
        }
    }

    private fun scheduleSpeakingEnd(bytes: Int, alreadyElapsedMs: Long = 0L) {
        speakJob?.cancel()
        val duration = (bytes / 2.0 / rate.coerceAtLeast(1) * 1000).toLong()
        val ms = (duration - alreadyElapsedMs).coerceIn(200L, 120_000L)
        speakJob = viewModelScope.launch {
            delay(ms)
            if (alive) _state.update { it.copy(speaking = false) }
        }
    }

    private fun startHold() {
        if (_state.value.link != Link.Live) {
            _state.update { it.copy(status = "示例模式不收音。连上本机实时服务后，才能把声音送出去。") }
            return
        }
        if (ContextCompat.checkSelfPermission(getApplication(), Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            _state.update { it.copy(status = "没有麦克风权限。可以打字。") }
            return
        }
        if (recordThread?.isAlive == true) return
        stopSpeaking()
        val running = AtomicBoolean(true)
        recordStop = running
        _state.update { it.copy(holding = true, status = "在听。松手就发给她。") }
        val sampleRate = rate
        val thread = Thread({ recordLoop(sampleRate, running) }, "shorekeeper-mic")
        recordThread = thread
        thread.start()
    }

    private fun stopHold() {
        recordStop?.set(false)
        recordStop = null
        try {
            liveRecorder?.stop()
        } catch (_: IllegalStateException) {
            // Already stopped, or not started yet.
        }
        if (_state.value.holding) _state.update { it.copy(holding = false) }
    }

    private fun recordLoop(sampleRate: Int, running: AtomicBoolean) {
        val min = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (min <= 0) {
            postStatus("这台手机开不了麦克风。可以打字。")
            return
        }
        val audio = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                min * 2,
            )
        } catch (_: IllegalArgumentException) {
            postStatus("这台手机开不了麦克风。可以打字。")
            return
        } catch (_: SecurityException) {
            postStatus("没有麦克风权限。可以打字。")
            return
        }
        if (audio.state != AudioRecord.STATE_INITIALIZED) {
            audio.release()
            postStatus("麦克风没有就绪。可以打字。")
            return
        }
        liveRecorder = audio
        val buffer = ByteArray(min)
        var sent = false
        try {
            audio.startRecording()
            while (running.get()) {
                val read = audio.read(buffer, 0, buffer.size)
                if (read > 0) {
                    sent = true
                    val encoded = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)
                    socket?.send(JSONObject().put("type", "audio").put("pcm", encoded).toString())
                } else if (read < 0) {
                    break
                }
            }
        } catch (_: IllegalStateException) {
            // stop() unblocked the read.
        } catch (_: SecurityException) {
            postStatus("没有麦克风权限。可以打字。")
        } finally {
            if (liveRecorder === audio) liveRecorder = null
            try {
                audio.stop()
            } catch (_: IllegalStateException) {
                // Not recording.
            }
            audio.release()
        }
        if (sent && alive && socket != null && _state.value.link == Link.Live) {
            socket?.send("""{"type":"commit"}""")
        }
    }

    private fun postStatus(message: String) {
        viewModelScope.launch {
            if (!alive) return@launch
            _state.update { it.copy(holding = false, status = message) }
        }
    }

    private fun failLink(message: String) {
        generation += 1
        connectJob?.cancel()
        stopHold()
        val current = socket
        socket = null
        current?.close()
        player.stop()
        sampleVoice.stop()
        _state.update {
            it.copy(link = Link.Sample, holding = false, speaking = false, status = message)
        }
    }

    private fun explainFailure(message: String): String {
        if (message.contains("INWORLD_API_KEY")) {
            return "本机没有 INWORLD_API_KEY。写在环境变量或 ~/.dsh/.env。不要写进手机。"
        }
        if (message.contains("CLEARTEXT")) {
            return "系统拦住了明文 WebSocket。请用 ws:// 连本机服务。"
        }
        val lower = message.lowercase()
        if (
            lower.contains("failed to connect") ||
            lower.contains("connection refused") ||
            lower.contains("econnrefused") ||
            lower.contains("unable to resolve") ||
            lower.contains("network is unreachable") ||
            lower.contains("timeout")
        ) {
            return "连不上本机语音。先在电脑运行 packages/shorekeeper-tts/realtime-demo 里的 server.mjs。模拟器选 10.0.2.2，USB 手机先 adb reverse 再选 127.0.0.1。"
        }
        return message.ifBlank { "连不上本机语音。" }
    }

    private fun append(hers: Boolean, text: String, sample: Boolean) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        _state.update { state ->
            val previous = state.lines.lastOrNull()
            if (previous != null && previous.hers == hers && previous.text == clean) return@update state
            val id = (state.lines.lastOrNull()?.id ?: 0L) + 1
            val next = (state.lines + SpeechLine(id, hers, clean, sample)).takeLast(80)
            state.copy(lines = next)
        }
    }

    private fun concat(parts: List<ByteArray>): ByteArray {
        if (parts.isEmpty()) return ByteArray(0)
        val out = ByteArray(parts.sumOf { it.size })
        var offset = 0
        for (part in parts) {
            part.copyInto(out, offset)
            offset += part.size
        }
        return out
    }

    private companion object {
        const val PREFS = "companion"
        const val KEY_URL = "server_url"
        const val SAMPLE_NOTE = "系统语音，不是守岸人音色"
        const val INWORLD_NOTE = "守岸人音色"
    }
}
