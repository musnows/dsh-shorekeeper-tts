package dev.musnows.shorekeeper.companion.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.musnows.shorekeeper.companion.CompanionViewModel
import dev.musnows.shorekeeper.companion.Link
import dev.musnows.shorekeeper.companion.SamplePresence
import dev.musnows.shorekeeper.companion.ServerUrl
import dev.musnows.shorekeeper.companion.SpeechLine
import dev.musnows.shorekeeper.companion.Tab
import dev.musnows.shorekeeper.companion.UiState

private val Ink = Color(0xFF071018)
private val Foam = Color(0xFFE7F4F8)
private val Crystal = Color(0xFF9FD4E5)
private val Sand = Color(0xFFC6B48A)
private val Deep = Color(0xFF10202B)
private val Tide = Color(0xFF1C3A48)

@Composable
fun CompanionApp(model: CompanionViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = { BottomNav(state.tab, model::select) },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (state.tab) {
                Tab.Home -> HomePage(state, model)
                Tab.Talk -> TalkPage(state, model)
                Tab.Listen -> ListenPage(state, model)
            }
        }
    }
}

@Composable
private fun BottomNav(tab: Tab, onSelect: (Tab) -> Unit) {
    NavigationBar(containerColor = Color(0xFF0B1822)) {
        NavItem(tab, Tab.Home, "在", Icons.Filled.Home, onSelect)
        NavItem(tab, Tab.Talk, "说", Icons.Filled.Edit, onSelect)
        NavItem(tab, Tab.Listen, "听", Icons.Filled.PlayArrow, onSelect)
    }
}

@Composable
private fun RowScope.NavItem(
    current: Tab,
    tab: Tab,
    label: String,
    icon: ImageVector,
    onSelect: (Tab) -> Unit,
) {
    NavigationBarItem(
        selected = current == tab,
        onClick = { onSelect(tab) },
        icon = { Icon(icon, contentDescription = label) },
        label = { Text(label) },
    )
}

@Composable
private fun HomePage(state: UiState, model: CompanionViewModel) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        StatusChip(state.link)
        Spacer(Modifier.height(28.dp))
        Presence(state.speaking || state.link == Link.Live)
        Spacer(Modifier.height(18.dp))
        Text("守岸人", style = MaterialTheme.typography.headlineMedium, color = Foam)
        Spacer(Modifier.height(12.dp))
        Text(
            SamplePresence.greeting(state.hour),
            style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 28.sp),
            textAlign = TextAlign.Center,
            color = Foam,
        )
        Spacer(Modifier.height(28.dp))
        Button(
            onClick = { if (state.link == Link.Sample) model.connect() else model.disconnect() },
            enabled = state.link != Link.Connecting,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                when (state.link) {
                    Link.Sample -> "连上本机语音"
                    Link.Connecting -> "正在连接"
                    Link.Live -> "断开，回到示例"
                },
            )
        }
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = state.serverUrl,
            onValueChange = model::setUrl,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("本机语音地址") },
            singleLine = true,
            enabled = state.link == Link.Sample,
        )
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AssistChip(
                onClick = { model.usePreset(ServerUrl.EMULATOR) },
                label = { Text("模拟器") },
                enabled = state.link == Link.Sample,
            )
            AssistChip(
                onClick = { model.usePreset(ServerUrl.USB) },
                label = { Text("USB 手机") },
                enabled = state.link == Link.Sample,
            )
        }
        Spacer(Modifier.height(12.dp))
        Text(
            state.status,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "本地示例不需要钥匙。回复写在手机里，朗读用系统语音。实时语音走电脑上的 realtime-demo，钥匙放在电脑的 INWORLD_API_KEY 或 ~/.dsh/.env，不要写进手机。",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall.copy(lineHeight = 18.sp),
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun StatusChip(link: Link) {
    val (label, color) = when (link) {
        Link.Sample -> "本地示例" to Sand
        Link.Connecting -> "正在连接" to Crystal
        Link.Live -> "实时语音" to Crystal
    }
    Surface(color = color.copy(alpha = 0.16f), shape = RoundedCornerShape(999.dp)) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            color = color,
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

@Composable
private fun Presence(awake: Boolean) {
    val transition = rememberInfiniteTransition(label = "breath")
    val breath by transition.animateFloat(
        initialValue = 0.94f,
        targetValue = if (awake) 1.08f else 1.04f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = if (awake) 900 else 3400,
                easing = FastOutSlowInEasing,
            ),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "breath",
    )
    Box(Modifier.size(180.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(160.dp * breath)
                .background(
                    Brush.radialGradient(listOf(Crystal.copy(alpha = 0.85f), Color(0x00203A48))),
                    CircleShape,
                ),
        )
        Box(
            Modifier
                .size(72.dp)
                .border(1.dp, Foam.copy(alpha = 0.85f), CircleShape),
        )
    }
}

@Composable
private fun TalkPage(state: UiState, model: CompanionViewModel) {
    val listState = rememberLazyListState()
    LaunchedEffect(state.lines.size) {
        if (state.lines.isNotEmpty()) listState.animateScrollToItem(state.lines.lastIndex)
    }
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) model.note("没有麦克风权限。可以打字。")
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        val banner = when (state.link) {
            Link.Sample -> "本地示例。这些回复写在手机里，不是守岸人实时会话。"
            Link.Connecting -> "正在连接本机语音。接上之前，先不发送。"
            Link.Live -> null
        }
        if (banner != null) {
            Text(
                banner,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                color = Sand,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text(
            state.status,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
        )
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (state.lines.isEmpty()) {
                item {
                    Text(
                        "跟她说一句。没连上时，她用本地示例回答。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }
            items(state.lines, key = { it.id }) { line -> Bubble(line) }
        }
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (state.holding) "松手" else "按住说",
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(if (state.holding) Crystal else Tide)
                    .semantics { contentDescription = "按住说话" }
                    .pointerInput(state.link) {
                        detectTapGestures(
                            onPress = {
                                val live = state.link == Link.Live
                                val granted = ContextCompat.checkSelfPermission(
                                    context,
                                    Manifest.permission.RECORD_AUDIO,
                                ) == PackageManager.PERMISSION_GRANTED
                                if (!live) {
                                    model.hold(true)
                                } else if (!granted) {
                                    permission.launch(Manifest.permission.RECORD_AUDIO)
                                } else {
                                    model.hold(true)
                                    tryAwaitRelease()
                                    model.hold(false)
                                }
                            },
                        )
                    }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                color = if (state.holding) Ink else Foam,
            )
            Spacer(Modifier.width(8.dp))
            OutlinedTextField(
                value = state.draft,
                onValueChange = model::setDraft,
                modifier = Modifier.weight(1f),
                placeholder = { Text("跟她说") },
                maxLines = 4,
            )
            Spacer(Modifier.width(8.dp))
            FilledIconButton(
                onClick = model::send,
                enabled = state.draft.isNotBlank() && state.link != Link.Connecting,
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "送出")
            }
        }
    }
}

@Composable
private fun Bubble(line: SpeechLine) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (line.hers) Alignment.Start else Alignment.End,
    ) {
        Surface(
            color = if (line.hers) Deep else Tide,
            shape = RoundedCornerShape(18.dp),
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(
                    line.text,
                    color = Foam,
                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 26.sp),
                )
                if (line.sample) {
                    Text("示例", color = Sand, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun ListenPage(state: UiState, model: CompanionViewModel) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(state.voiceNote, color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(24.dp))
        Text(
            state.lastSpoken.ifBlank { "还没有句子。" },
            style = MaterialTheme.typography.headlineSmall.copy(lineHeight = 34.sp),
            textAlign = TextAlign.Center,
            color = Foam,
        )
        Spacer(Modifier.height(28.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = model::playLast, enabled = state.lastSpoken.isNotBlank()) {
                Text(if (state.speaking) "再说一遍" else "听她说")
            }
            OutlinedButton(onClick = model::stopSpeaking, enabled = state.speaking) {
                Text("停下")
            }
        }
        Spacer(Modifier.height(24.dp))
        Text(
            if (state.link == Link.Live) {
                "实时语音的声音来自 Inworld 的守岸人音色，和桌宠同一条。播放用的是服务推来的 PCM。"
            } else {
                "现在播的是手机系统语音，用来让这页在没有钥匙时也能出声。它不是守岸人音色。"
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp),
            textAlign = TextAlign.Center,
        )
        if (state.link == Link.Live && state.speaking) {
            Spacer(Modifier.height(16.dp))
            Text(state.status, color = Crystal, style = MaterialTheme.typography.bodySmall)
        }
    }
}
