# Jackalope bot computer: a small Debian desktop an agent controls.
# Published for linux/amd64 by .github/workflows/computer-image.yml, or built
# where it runs; see docs/BOT-COMPUTERS.md.
FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb openbox x11vnc novnc websockify \
        chromium fonts-liberation fonts-noto-color-emoji \
        python3 python3-pil python3-pyatspi at-spi2-core dbus dbus-x11 \
        xdotool xclip wmctrl scrot socat ca-certificates procps xterm \
        git nodejs npm \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash --uid 1000 bot

# Agent CLIs for tasks that run their agent on this computer. Codex
# (Apache-2.0) is fixed when the image is built. Claude Code's license does not
# allow redistributing it, so agent.py installs it into ~/.local on first use.
RUN npm install --global --no-fund --no-audit @openai/codex \
    && npm cache clean --force

# Each Debian package's notices stay in /usr/share/doc/<package>/copyright (the
# slim image's dpkg filter keeps them); do not remove them.
RUN mkdir -p /usr/share/doc/jackalope-computer \
    && printf '%s\n' \
        'Jackalope computer image. The Jackalope files in /opt/jackalope are' \
        'licensed under the Apache License 2.0, /usr/share/common-licenses/Apache-2.0.' \
        'Source: https://github.com/Jackalope-Dev/jackalope' \
        'Debian packages: /usr/share/doc/<package>/copyright' \
        'npm packages: /usr/local/lib/node_modules/<package>' \
        'Claude Code is not included; it is installed from npm on first use' \
        'under its own terms.' \
        > /usr/share/doc/jackalope-computer/NOTICE

COPY start.sh agent.py /opt/jackalope/
RUN chmod 0755 /opt/jackalope/start.sh && chmod 0644 /opt/jackalope/agent.py

ENV PATH=/home/bot/.local/bin:$PATH \
    DISPLAY=:1 \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/jackalope-bus \
    XDG_RUNTIME_DIR=/tmp/runtime-bot \
    LANG=C.UTF-8

USER bot
WORKDIR /home/bot
EXPOSE 6080 9223 8765
ENTRYPOINT ["/opt/jackalope/start.sh"]
