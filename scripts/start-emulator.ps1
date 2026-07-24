# WHAT:  One-command dev-emulator launcher: boots the Pixel_10_Pro_XL AVD,
#        recenters/resizes its window (it opens taller than the 1536x816
#        screen otherwise — window.scale=-1 auto-sizing), re-establishes the
#        adb reverse tunnel to Metro, and opens the Trackitdown dev client
#        against localhost:8081.
# WHY:   The emulator rewrites emulator-user.ini on close, so ini edits don't
#        stick — the window fix must run after every launch. The reverse
#        tunnel also dies with the emulator. Bundling all four steps means
#        "npm run emulator" (or right-click > Run with PowerShell) is the
#        whole workflow. Start Metro (npx expo start) separately.
# LINKS: docs/TESTING.md; the AVD is Pixel_10_Pro_XL.

$ErrorActionPreference = 'Stop'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"

# 1. Boot the AVD (skip if already running).
$running = Get-Process -Name 'qemu-system-x86_64' -ErrorAction SilentlyContinue
if (-not $running) {
  Start-Process -FilePath "$sdk\emulator\emulator.exe" -ArgumentList '-avd', 'Pixel_10_Pro_XL'
}

# 2. Wait for full boot, ENFORCING the window rect the whole time: the
#    emulator window appears (at its saved, possibly off-screen geometry)
#    long before Android finishes booting, and the emulator re-applies its
#    own geometry at several points during startup (seen 2026-07-23 at
#    y=-1010). Watchdog runs through boot + 20s after.
Add-Type @'
using System; using System.Runtime.InteropServices;
public class Win { [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int hgt,bool r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); public struct RECT { public int L,T,R,B; } }
'@
$TargetX = 558; $TargetY = 13
function Assert-EmulatorWindow {
  $p = Get-Process | Where-Object { $_.MainWindowTitle -match 'Pixel_10_Pro_XL' } | Select-Object -First 1
  if ($p) {
    $r = New-Object Win+RECT
    [Win]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
    # Re-assert whenever the TOP-LEFT drifts from the target corner. Checking
    # position (not size — the emulator snaps width to the device aspect)
    # catches every off-screen case, including shoved-off-the-right/bottom,
    # which the old "only if negative/too-tall" check missed.
    if ([Math]::Abs($r.L - $TargetX) -gt 8 -or [Math]::Abs($r.T - $TargetY) -gt 8) {
      [Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
      [Win]::MoveWindow($p.MainWindowHandle, $TargetX, $TargetY, 420, 790, $true) | Out-Null
    }
  }
}

& $adb wait-for-device
while ((& $adb shell getprop sys.boot_completed 2>$null) -notmatch '1') {
  Assert-EmulatorWindow
  Start-Sleep -Milliseconds 1200
}

# 4. Metro tunnel (dies with every emulator restart) + open the dev client.
& $adb reverse tcp:8081 tcp:8081
& $adb shell am start -a android.intent.action.VIEW -d 'trackitdown://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'

# 5. GPS: place the device in Hertfordshire (Hertford, 51.7959 N, 0.0780 W)
#    so "Use my location" and the map centre on the seeded posts' region.
#    `geo fix` takes LONGITUDE then LATITUDE. adb emu auto-auths from
#    ~/.emulator_console_auth_token (must be a VALID token — a corrupt/all-zero
#    file makes this fail with "missing authentication token"; delete it so the
#    emulator regenerates one). Non-fatal if it can't send.
try { & $adb emu geo fix -0.0780 51.7959 | Out-Null } catch {}

Write-Host 'Emulator ready: window centered, Metro tunnel up, app launched, location = Hertfordshire.'

# 6. Keep the window pinned for 40s AFTER launch — the emulator restores its
#    saved (often off-screen) geometry late in startup; a tight re-assert
#    corrects a late nudge within ~1s without delaying the app opening above.
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  Assert-EmulatorWindow
  Start-Sleep -Milliseconds 1200
}
