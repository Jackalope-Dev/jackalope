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
