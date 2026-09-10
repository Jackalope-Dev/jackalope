---
name: run-jackalope-desktop
description: Build, launch and inspect native Jackalope with an isolated test profile. Use for native verification, with platform-specific process, credential-store and device checks.
---

# Native desktop verification

Follow [SELF-DEVELOPMENT.md](../../../docs/SELF-DEVELOPMENT.md). Build the frontend
before the native binary; use an absolute JACKALOPE_PROFILE_DIR unique to the
test. Retain the returned process ID and stop only that instance. Do not force-stop
every Jackalope process or use a contributor's everyday profile.

A running process does not prove a window rendered. Inspect the actual native
window and interactions, then distinguish real native responses from fixtures.
Signed-install/update acceptance requires the separate release trials.

On macOS/Linux, follow [platform prerequisites and checks](../../../docs/CROSS-PLATFORM-RELEASES.md#native-checks-on-your-devices).
GUI launch, keyring behavior, notifications and desktop grants require native device
checks; WSL, Xvfb and browser fixtures each cover only their stated environment.
Report evidence in the task/PR response. Keep profiles, screenshots, logs and completed
test records outside tracked source under [documentation policy](../../../docs/DOCUMENTATION.md).
