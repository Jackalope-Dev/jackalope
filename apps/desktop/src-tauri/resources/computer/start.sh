#!/bin/sh
# Starts the bot computer's display, window manager, viewer and browser.
# Runs as the unprivileged `bot` user; Docker's --init reaps children.
set -eu

width="${JACKALOPE_SCREEN_WIDTH:-1280}"
height="${JACKALOPE_SCREEN_HEIGHT:-800}"
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.vnc"
chmod 700 "$XDG_RUNTIME_DIR" "$HOME/.vnc"
rm -f /tmp/.X1-lock /tmp/jackalope-bus

Xvfb :1 -screen 0 "${width}x${height}x24" -nolisten tcp &
for _ in $(seq 1 50); do
    [ -S /tmp/.X11-unix/X1 ] && break
    sleep 0.1
done

dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork --nopidfile
/usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 &
openbox >/dev/null 2>&1 &

# The viewer listens only inside the container; Docker publishes it to the
# host's loopback interface. Without a password there is no viewer.
if [ -n "${JACKALOPE_VNC_PASSWORD:-}" ]; then
    x11vnc -storepasswd "$JACKALOPE_VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null 2>&1
    x11vnc -display :1 -rfbauth "$HOME/.vnc/passwd" -localhost -rfbport 5900 \
        -forever -shared -quiet -noxdamage >/dev/null 2>&1 &
    websockify --web /usr/share/novnc 6080 127.0.0.1:5900 >/dev/null 2>&1 &
fi
unset JACKALOPE_VNC_PASSWORD

python3 /opt/jackalope/agent.py browser >/dev/null 2>&1 || true
# Chromium's DevTools endpoint binds to loopback inside the container; this
# forward lets the host's published loopback port reach it.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/dev/null 2>&1 &

# Remote machines serve the agent over HTTP behind the operator's HTTPS proxy.
if [ -n "${JACKALOPE_COMPUTER_TOKEN:-}" ]; then
    python3 /opt/jackalope/agent.py http "0.0.0.0:${JACKALOPE_AGENT_PORT:-8765}" &
fi

while :; do
    sleep 3600
done
