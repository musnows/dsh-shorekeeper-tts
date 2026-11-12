package dev.musnows.shorekeeper.companion

import java.net.URI
import java.net.URISyntaxException

object ServerUrl {
    const val EMULATOR = "ws://10.0.2.2:18765/ws"
    const val USB = "ws://127.0.0.1:18765/ws"

    fun normalize(raw: String): String? {
        val text = raw.trim()
        if (!text.startsWith("ws://") && !text.startsWith("wss://")) return null
        val uri = try {
            URI(text)
        } catch (_: URISyntaxException) {
            return null
        }
        val authority = uri.authority ?: return null
        if (authority.isEmpty() || uri.host.isNullOrEmpty()) return null
        val path = uri.rawPath ?: ""
        if (path.isNotEmpty() && path != "/") return text
        return "${uri.scheme}://$authority/ws"
    }
}
