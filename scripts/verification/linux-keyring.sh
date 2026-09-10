#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

fixture=$(mktemp -d /tmp/jackalope-keyring.XXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export HOME="$fixture"
export XDG_DATA_HOME="$fixture/data"
export XDG_CONFIG_HOME="$fixture/config"
export XDG_RUNTIME_DIR="$fixture/runtime"
mkdir -m 700 "$XDG_RUNTIME_DIR"

dbus-run-session -- bash -euc '
  printf "%s" "jackalope-disposable-keyring-fixture" |
    gnome-keyring-daemon --unlock --components=secrets --control-directory="$XDG_RUNTIME_DIR/keyring"
  timeout --kill-after=3s 90s cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features native_keyring_round_trip_update_and_delete -- --ignored --test-threads=1
'
