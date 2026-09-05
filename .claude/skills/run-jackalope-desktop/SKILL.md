---
name: run-jackalope-desktop
description: Launch the Jackalope Tauri desktop app natively on Windows and verify/screenshot the window. Use whenever asked to run, launch, or visually verify the Jackalope app works (not just typecheck/cargo check).
---

# Running Jackalope (native Windows desktop)

This is a Tauri v2 app. `cargo check` only type/borrow-checks — it does
NOT prove the app launches. To actually verify a change works, build
and launch the real window.

## 1. Build the frontend + native binary

```bash
cd apps/desktop
pnpm build                     # tsc -b && vite build -> apps/desktop/dist
export PATH="/c/Users/developer/.cargo/bin:$PATH"
cd src-tauri
cargo build                    # full compile + link, ~2-3 min cold, seconds if cached
```

The exe lands at `apps/desktop/src-tauri/target/debug/jackalope-desktop.exe`.
It loads `tauri.conf.json`'s `frontendDist` (`../dist`), so `pnpm build`
must be run first or the window will show stale/missing content.

## 2. Launch it and confirm it stays alive (PowerShell, not Bash — GUI process)

```powershell
$exe = "C:\Users\developer\Desktop\jackalope\apps\desktop\src-tauri\target\debug\jackalope-desktop.exe"
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 4
Get-Process -Id $proc.Id -ErrorAction SilentlyContinue   # non-null => still running, no immediate crash/panic
```

## 3. Screenshot the window (optional but recommended for visual verification)

```powershell
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$proc = Get-Process -Id <PID>
[Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$bmp.Save("<scratchpad>\jackalope-window.png", [System.Drawing.Imaging.ImageFormat]::Png)
```

Then use the Read tool on the saved PNG path to actually view it — don't
just trust that the save succeeded, look at the rendered content.

## ⚠️ Before clicking anything: verify Jackalope is ACTUALLY foreground

`SetForegroundWindow` can silently fail (Windows blocks foreground-stealing
from a background process under normal focus-stealing prevention rules) —
the call returning success doesn't mean it worked. If it fails, `GetWindowRect`
still returns Jackalope's correct coordinates (that's a property of the
window, not of focus), but `CopyFromScreen` grabs whatever is *actually
on screen* at those coordinates, and `mouse_event`/`SetCursorPos` clicks
land on whatever window is *actually on top* — which may be a completely
different, unrelated application if one happens to overlap that screen
region. This has actually happened on this machine (2026-09-04): a test
session's screenshot turned out to be the user's ChatGPT desktop app, not
Jackalope, and a click may have landed in it.

**Before any click-based interaction** (not just a passive screenshot),
confirm the real foreground window first:

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCheck {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$fg = [WinCheck]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[WinCheck]::GetWindowText($fg, $sb, 256) | Out-Null
$fgProcId = 0
[WinCheck]::GetWindowThreadProcessId($fg, [ref]$fgProcId) | Out-Null
if ($fgProcId -ne $jackalopePid) { Write-Host "NOT Jackalope in foreground: '$($sb.ToString())' (PID $fgProcId) — do not click yet" }
```

If it's not Jackalope, don't click blindly — this machine may have other
apps or agent sessions open concurrently. Either retry bringing Jackalope
forward and re-check, or abandon the click-based test for this session
(a passive screenshot capture with no clicks is comparatively low-risk;
issuing clicks without confirming foreground is not).

## 4. Close it

```powershell
Stop-Process -Id <PID> -Force
```

## Notes

- This is native Windows, not a Linux container — no xvfb/Playwright
  `_electron` driver needed (that pattern is for headless Linux CI).
- Rust toolchain (rustup stable-msvc) and VS 2022 Build Tools are
  already installed on this machine as of 2026-09-04.
- If the window shows blank/white, `pnpm build` probably wasn't run
  first, or `dist/` is stale relative to the source.
- First `cargo build` after a fresh clone/toolchain-change is slow
  (~2-3 min, compiling ~150 crates); subsequent builds are incremental
  and much faster.
