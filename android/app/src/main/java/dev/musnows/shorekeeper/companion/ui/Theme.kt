package dev.musnows.shorekeeper.companion.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Shore = darkColorScheme(
    background = Color(0xFF071018),
    surface = Color(0xFF10202B),
    surfaceVariant = Color(0xFF173140),
    primary = Color(0xFF9FD4E5),
    onPrimary = Color(0xFF062028),
    primaryContainer = Color(0xFF173140),
    onPrimaryContainer = Color(0xFFE7F4F8),
    secondary = Color(0xFFC6B48A),
    onSecondary = Color(0xFF221C10),
    secondaryContainer = Color(0xFF1C3A48),
    onSecondaryContainer = Color(0xFFE7F4F8),
    onBackground = Color(0xFFE7F4F8),
    onSurface = Color(0xFFE7F4F8),
    onSurfaceVariant = Color(0xFF8AA4B0),
    outline = Color(0xFF2C4A5A),
)

@Composable
fun ShorekeeperTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Shore, content = content)
}
