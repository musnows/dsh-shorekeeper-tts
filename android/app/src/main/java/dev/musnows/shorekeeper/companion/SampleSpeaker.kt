package dev.musnows.shorekeeper.companion

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Sample-mode voice. This is the phone's own speech engine, not the
 * Shorekeeper Inworld voice. Callers have to say so on screen.
 */
class SampleSpeaker(context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var ready = false
    private var chinese = false
    private val tts: TextToSpeech

    init {
        lateinit var engine: TextToSpeech
        engine = TextToSpeech(context.applicationContext) { status ->
            if (status != TextToSpeech.SUCCESS) return@TextToSpeech
            ready = true
            chinese = selectChinese(engine)
            if (chinese) engine.setSpeechRate(0.92f)
        }
        tts = engine
    }

    fun canSpeakChinese(): Boolean = ready && chinese

    fun speak(text: String, onDone: () -> Unit): Boolean {
        if (!ready || !chinese || text.isBlank()) return false
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) {
                main.post(onDone)
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                main.post(onDone)
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                main.post(onDone)
            }
        })
        val result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "shorekeeper-sample")
        return result != TextToSpeech.ERROR
    }

    fun stop() {
        if (ready) tts.stop()
    }

    fun shutdown() {
        ready = false
        tts.shutdown()
    }

    private fun selectChinese(engine: TextToSpeech): Boolean {
        val locales = listOf(Locale.SIMPLIFIED_CHINESE, Locale.CHINESE, Locale.CHINA)
        for (locale in locales) {
            val result = engine.setLanguage(locale)
            if (result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED) {
                return true
            }
        }
        return false
    }
}
