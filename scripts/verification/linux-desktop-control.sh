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
  report() { echo "--- openbox.log"; cat "$HOME/openbox.log"; echo "--- compositor.log"; cat "$HOME/compositor.log"; } >&2
  trap '\''status=$?; [ "$status" = 0 ] || report; kill "$wm" "$compositor" 2>/dev/null || true; wait "$wm" "$compositor" 2>/dev/null || true; exit "$status"'\'' EXIT
  # The helper lists only windows the manager has registered, so wait until openbox publishes EWMH state.
  for _ in $(seq 100); do xdotool get_desktop >/dev/null 2>&1 && break; sleep 0.1; done
  xdotool get_desktop >/dev/null 2>&1 || { echo "openbox did not start managing the display" >&2; exit 1; }
  python3 "$JACKALOPE_X11_TRIAL" "$JACKALOPE_X11_HELPER"
'
