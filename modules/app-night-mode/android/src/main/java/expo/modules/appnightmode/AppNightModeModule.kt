/*
 * WHAT:  AppNightMode — tells Android which Light/Dark mode THIS app uses, so
 *        the system-drawn launch splash follows the in-app choice.
 * WHY:   The launch splash on Android 12+ is drawn by the system before any of
 *        our code runs, so it could only see the phone's theme — a dark phone
 *        with the app set to Light showed black for a second or two on every
 *        cold start (owner, 2026-10-20). UiModeManager.setApplicationNightMode
 *        (API 31) persists a per-app night mode that the system applies to the
 *        app's configuration, the launch splash included, from the next start.
 *        Appearance.setColorScheme (AppCompat) is in-process only and
 *        forgotten on restart, which is why it could never reach the splash.
 * LINKS: src/shared/theme/appNightMode.ts (the JS side);
 *        src/shared/theme/ThemeProvider.tsx (the caller);
 *        docs/decisions/ADR-0013-dark-mode.md.
 */

package expo.modules.appnightmode

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppNightModeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppNightMode")

    // "light" | "dark" | "system". Returns whether the system took it: false
    // below Android 12, where there is no per-app mode to set.
    Function("setApplicationNightMode") { mode: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@Function false
      }
      val context = appContext.reactContext ?: return@Function false
      val uiModeManager =
        context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
          ?: return@Function false
      val nightMode = when (mode) {
        "light" -> UiModeManager.MODE_NIGHT_NO
        "dark" -> UiModeManager.MODE_NIGHT_YES
        // For a single app, AUTO maps to "undefined": no override, so the app
        // and its splash follow the phone again (UiModeManagerService).
        "system" -> UiModeManager.MODE_NIGHT_AUTO
        // Anything else is a bug upstream — never let it clear a real choice.
        else -> return@Function false
      }
      uiModeManager.setApplicationNightMode(nightMode)
      true
    }
  }
}
