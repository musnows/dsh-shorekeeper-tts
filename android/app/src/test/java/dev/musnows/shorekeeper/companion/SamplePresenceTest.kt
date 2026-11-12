package dev.musnows.shorekeeper.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SamplePresenceTest {
    @Test
    fun greetingFollowsTheHour() {
        assertTrue(SamplePresence.greeting(3).contains("没睡"))
        assertTrue(SamplePresence.greeting(8).contains("我在"))
        assertTrue(SamplePresence.greeting(15).contains("可以听"))
        assertTrue(SamplePresence.greeting(20).contains("回来"))
        assertTrue(SamplePresence.greeting(23).contains("没睡"))
    }

    @Test
    fun emptyInputStillAnswers() {
        assertEquals("我在听。", SamplePresence.reply("  "))
    }

    @Test
    fun tiredReplyStaysWithHer() {
        val reply = SamplePresence.reply("我好累")
        assertTrue(reply.contains("我在这儿"))
        assertFalse(reply.contains("加油"))
    }

    @Test
    fun searchIsMarkedAsUnavailableOffline() {
        assertTrue(SamplePresence.reply("帮我搜新闻").contains("本地示例"))
    }

    @Test
    fun serverUrlGainsTheSocketPath() {
        assertEquals(ServerUrl.EMULATOR, ServerUrl.normalize("ws://10.0.2.2:18765"))
        assertEquals(ServerUrl.USB, ServerUrl.normalize("  ws://127.0.0.1:18765/ws  "))
        assertEquals("wss://shore.example/ws", ServerUrl.normalize("wss://shore.example"))
    }

    @Test
    fun serverUrlRejectsOtherSchemes() {
        assertNull(ServerUrl.normalize("http://10.0.2.2:18765/ws"))
        assertNull(ServerUrl.normalize("ws://"))
        assertNull(ServerUrl.normalize(""))
    }
}
