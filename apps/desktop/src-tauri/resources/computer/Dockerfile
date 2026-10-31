# Jackalope bot computer: a small Debian desktop an agent controls.
# Built locally by Jackalope on first use; see docs/BOT-COMPUTERS.md.
FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb openbox x11vnc novnc websockify \
        chromium fonts-liberation fonts-noto-color-emoji \
        python3 python3-pil python3-pyatspi at-spi2-core dbus dbus-x11 \
        xdotool xclip wmctrl scrot socat ca-certificates procps xterm \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash --uid 1000 bot

COPY start.sh agent.py /opt/jackalope/
RUN chmod 0755 /opt/jackalope/start.sh && chmod 0644 /opt/jackalope/agent.py

ENV DISPLAY=:1 \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/jackalope-bus \
    XDG_RUNTIME_DIR=/tmp/runtime-bot \
    LANG=C.UTF-8

USER bot
WORKDIR /home/bot
EXPOSE 6080 9223 8765
ENTRYPOINT ["/opt/jackalope/start.sh"]
