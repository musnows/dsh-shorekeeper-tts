package dev.musnows.shorekeeper.companion

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Plays the s16le mono PCM chunks the realtime server already sends. */
class PcmPlayer {
    private val io = Executors.newSingleThreadExecutor()

    @Volatile
    private var generation = 0
    private var track: AudioTrack? = null
    private var rate = 0

    fun write(sampleRate: Int, pcm: ByteArray) {
        if (pcm.isEmpty() || sampleRate <= 0) return
        val gen = generation
        execute {
            if (gen != generation) return@execute
            val current = if (track != null && rate == sampleRate) track else open(sampleRate)
            if (current == null || gen != generation) return@execute
            writeAll(current, pcm, gen)
        }
    }

    fun play(sampleRate: Int, pcm: ByteArray) {
        if (pcm.isEmpty() || sampleRate <= 0) return
        val gen = synchronized(this) { ++generation }
        execute {
            releaseTrack()
            if (gen != generation) return@execute
            val current = open(sampleRate) ?: return@execute
            writeAll(current, pcm, gen)
        }
    }

    fun stop() {
        synchronized(this) { generation += 1 }
        execute { releaseTrack() }
    }

    fun release() {
        synchronized(this) { generation += 1 }
        execute { releaseTrack() }
        io.shutdown()
    }

    private fun execute(block: () -> Unit) {
        try {
            io.execute(block)
        } catch (_: RejectedExecutionException) {
            // The player was released with the screen.
        }
    }

    private fun open(sampleRate: Int): AudioTrack? {
        releaseTrack()
        val min = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (min <= 0) return null
        val built = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(min * 4)
            .build()
        built.play()
        track = built
        rate = sampleRate
        return built
    }

    private fun writeAll(current: AudioTrack, pcm: ByteArray, gen: Int) {
        var offset = 0
        while (offset < pcm.size && gen == generation) {
            val wrote = try {
                current.write(pcm, offset, pcm.size - offset)
            } catch (_: IllegalStateException) {
                return
            }
            if (wrote <= 0) return
            offset += wrote
        }
    }

    private fun releaseTrack() {
        val current = track
        track = null
        if (current == null) return
        try {
            current.pause()
            current.flush()
            current.stop()
        } catch (_: IllegalStateException) {
            // Already stopped.
        }
        current.release()
    }
}
