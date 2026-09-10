#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
helper=${1:-"$root/apps/desktop/src-tauri/resources/desktop-control/jackalope-desktop-control"}
fixture=$(mktemp -d /tmp/jackalope-wayland-session-XXXXXX)
cleanup() { rm -rf -- "$fixture"; }
trap cleanup EXIT
mkdir -m 700 "$fixture/home" "$fixture/runtime"
export HOME="$fixture/home" XDG_RUNTIME_DIR="$fixture/runtime" XDG_CONFIG_HOME="$fixture/home/config"
export XDG_DATA_HOME="$fixture/home/data" XDG_CACHE_HOME="$fixture/home/cache"
export GSETTINGS_BACKEND=keyfile XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME GNOME_SHELL_SESSION_MODE=user
export LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND=wayland GTK_MODULES=atk-bridge GTK_IM_MODULE=wayland NO_AT_BRIDGE=0
export JACKALOPE_WAYLAND_FIXTURE=private-headless-session JACKALOPE_WAYLAND_HELPER="$helper"
export JACKALOPE_WAYLAND_TRIAL="$root/scripts/verification/linux-wayland-control.py"
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS
uuid=desktop-control@jackalope.dev
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions/$uuid"
cp "$root/apps/desktop/src-tauri/resources/gnome-extension/$uuid/"* "$XDG_DATA_HOME/gnome-shell/extensions/$uuid/"
gsettings set org.gnome.shell enabled-extensions "['$uuid']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '46.0'
gsettings set org.gnome.desktop.interface enable-animations false
gsettings set org.gnome.desktop.interface enable-hot-corners false
timeout -k 10 150 dbus-run-session -- bash -c '
  set -euo pipefail
  gnome-shell --headless --wayland --no-x11 --virtual-monitor=1280x840 --wayland-display=jackalope-wayland --sm-disable >"$HOME/shell.log" 2>&1 & shell_pid=$!
  cleanup_shell() {
    kill "$shell_pid" 2>/dev/null || true
    wait "$shell_pid" 2>/dev/null || true
  }
  trap cleanup_shell EXIT
  export WAYLAND_DISPLAY=jackalope-wayland
  for i in $(seq 1 100); do
    [ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ] || break
    kill -0 "$shell_pid"
    sleep .1
  done
  sleep 6
  python3 "$JACKALOPE_WAYLAND_TRIAL" "$JACKALOPE_WAYLAND_HELPER" || { cat "$HOME/shell.log"; exit 1; }
'
