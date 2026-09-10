#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
helper=${1:-"$root/apps/desktop/src-tauri/resources/desktop-control/jackalope-desktop-control"}
fixture=$(mktemp -d /tmp/jackalope-x11-session-XXXXXX)
cleanup() { rm -rf -- "$fixture"; }
trap cleanup EXIT
mkdir -m 700 "$fixture/home" "$fixture/runtime"
export HOME="$fixture/home" XDG_RUNTIME_DIR="$fixture/runtime" XDG_CONFIG_HOME="$fixture/home/config"
export XDG_CACHE_HOME="$fixture/home/cache" XDG_DATA_HOME="$fixture/home/data"
export XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 GSETTINGS_BACKEND=memory NO_AT_BRIDGE=0 GTK_MODULES=atk-bridge
unset WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS
export JACKALOPE_X11_HELPER="$helper" JACKALOPE_X11_TRIAL="$root/scripts/verification/linux-desktop-control.py"
timeout 120 xvfb-run -a -s '-screen 0 1280x840x24 -nolisten tcp' dbus-run-session -- bash -c '
  set -euo pipefail
  openbox >"$HOME/openbox.log" 2>&1 & wm=$!
  xcompmgr >"$HOME/compositor.log" 2>&1 & compositor=$!
  trap '\''kill "$wm" "$compositor" 2>/dev/null || true; wait "$wm" "$compositor" 2>/dev/null || true'\'' EXIT
  python3 "$JACKALOPE_X11_TRIAL" "$JACKALOPE_X11_HELPER"
'
