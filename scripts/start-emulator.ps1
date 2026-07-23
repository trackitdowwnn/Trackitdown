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
function Assert-EmulatorWindow {
  $p = Get-Process | Where-Object { $_.MainWindowTitle -match 'Pixel_10_Pro_XL' } | Select-Object -First 1
  if ($p) {
    $r = New-Object Win+RECT
    [Win]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
    # On-screen and roughly the target size is good enough — the emulator
    # snaps width to the device aspect, so exact-match checks would loop.
    if ($r.T -lt 0 -or $r.T -gt 200 -or $r.L -lt 0 -or ($r.B - $r.T) -gt 820) {
      [Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
      [Win]::MoveWindow($p.MainWindowHandle, 558, 13, 420, 790, $true) | Out-Null
    }
  }
}

& $adb wait-for-device
while ((& $adb shell getprop sys.boot_completed 2>$null) -notmatch '1') {
  Assert-EmulatorWindow
  Start-Sleep -Seconds 2
}
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  Assert-EmulatorWindow
  Start-Sleep -Seconds 2
}

# 4. Metro tunnel (dies with every emulator restart) + open the dev client.
& $adb reverse tcp:8081 tcp:8081
& $adb shell am start -a android.intent.action.VIEW -d 'trackitdown://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'

Write-Host 'Emulator ready: window centered, Metro tunnel up, app launched.'
