package dev.musnows.shorekeeper.companion

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

sealed interface SocketEvent {
    data object Open : SocketEvent
    data class Message(val text: String) : SocketEvent
    data class Failed(val message: String) : SocketEvent
    data object Closed : SocketEvent
}

class RealtimeSocket(
    private val url: String,
    private val onEvent: (SocketEvent) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var webSocket: WebSocket? = null

    fun connect() {
        val request = Request.Builder().url(url).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                onEvent(SocketEvent.Open)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                onEvent(SocketEvent.Message(text))
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onEvent(SocketEvent.Closed)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val cause = t.cause?.message
                val message = buildString {
                    append(t.message ?: "连不上")
                    if (!cause.isNullOrBlank()) {
                        append(' ')
                        append(cause)
                    }
                }
                onEvent(SocketEvent.Failed(message))
            }
        })
    }

    fun send(json: String): Boolean = webSocket?.send(json) == true

    fun close() {
        try {
            webSocket?.close(1000, "bye")
        } catch (_: RuntimeException) {
            // The socket is already gone.
        }
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }
}
