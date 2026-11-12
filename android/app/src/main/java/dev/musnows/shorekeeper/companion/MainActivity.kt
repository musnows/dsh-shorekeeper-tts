package dev.musnows.shorekeeper.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.musnows.shorekeeper.companion.ui.CompanionApp
import dev.musnows.shorekeeper.companion.ui.ShorekeeperTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val shore = 0xFF071018.toInt()
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(shore),
            navigationBarStyle = SystemBarStyle.dark(shore),
        )
        setContent {
            ShorekeeperTheme {
                val model: CompanionViewModel = viewModel()
                CompanionApp(model)
            }
        }
    }
}
