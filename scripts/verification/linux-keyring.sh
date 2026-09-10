#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

fixture=$(mktemp -d /tmp/jackalope-keyring.XXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features --no-run --message-format=json > "$fixture/build.json"
JACKALOPE_KEYRING_TEST_BINARY=$(node -e '
  const fs = require("node:fs");
  const artifacts = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
  const tests = artifacts.filter(a => a.reason === "compiler-artifact" && a.profile.test && a.executable);
  if (tests.length !== 1) throw new Error("Expected one native test executable");
  process.stdout.write(tests[0].executable);
' "$fixture/build.json")
export JACKALOPE_KEYRING_TEST_BINARY
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
  timeout --kill-after=3s 90s "$JACKALOPE_KEYRING_TEST_BINARY" --exact commands::account_storage::keychain::tests::native_keyring_round_trip_update_and_delete --ignored --test-threads=1
'
