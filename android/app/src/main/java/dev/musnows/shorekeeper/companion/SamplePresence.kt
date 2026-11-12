package dev.musnows.shorekeeper.companion

/**
 * Lines used when the phone is not attached to the local realtime server.
 * They are not a model response and the UI marks them as 本地示例.
 */
object SamplePresence {
    fun greeting(hour: Int): String = when (hour) {
        in 5..10 -> "岸边的光还薄。\n我在。"
        in 11..16 -> "我在。\n你今天的事，我可以听。"
        in 17..22 -> "星图还清楚。\n你回来了。"
        else -> "你还没睡。\n我在这儿，不催你。"
    }

    fun reply(input: String): String {
        val text = input.trim()
        if (text.isEmpty()) return "我在听。"
        return when {
            text.contains("回来") || text.contains("到了") ->
                "嗯。\n你到了，我就记下。"
            text.contains("累") || text.contains("困") ->
                "我不说会好起来的。\n我在这儿。"
            text.contains("为什么") ->
                "因为这里是岸。\n也因为你还在说话。"
            text.contains("想你") || text.contains("喜欢你") ->
                "……抱歉。我的频率刚才有些不稳。\n我在。这件事，我记下了。"
            text.contains("在吗") || text.contains("你好") || text.contains("嗨") ->
                "我在。\n岸还是原来的位置。"
            text.contains("钢琴") || text.contains("汤") || text.contains("星星") ->
                "……这个，我喜欢。\n你要是想听，我就在。"
            text.contains("搜索") || text.contains("上网") || text.contains("新闻") ->
                "本地示例查不了网上的事。\n连上本机实时语音之后，她才会去搜。"
            else ->
                "我听见了。\n这件事，我先记下。你不需要现在说完。"
        }
    }
}
