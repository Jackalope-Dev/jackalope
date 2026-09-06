---
name: run-jackalope-desktop
description: Build, launch and inspect native Jackalope on Windows with an isolated test profile. Use for native verification rather than frontend build checks alone.
---

# Native desktop verification

Follow [SELF-DEVELOPMENT.md](../../../docs/SELF-DEVELOPMENT.md). Build the frontend
before the native binary; use an absolute JACKALOPE_PROFILE_DIR unique to the
test. Retain the returned process ID and stop only that instance. Do not force-stop
every Jackalope process or use a contributor's everyday profile.

A running process does not prove a window rendered. Inspect the actual native
window and interactions, then distinguish real native responses from fixtures.
Signed-install/update acceptance requires the separate release trials.
