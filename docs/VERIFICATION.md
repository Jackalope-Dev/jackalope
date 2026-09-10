# Verification tools

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for the combined `pnpm verify` gate and
targeted Node tests. This guide maps opt-in fixtures that are not all part of that
gate. Run from the repository root. Keep test receipts in ignored output/scratch;
report the actual check and its limits in the task or PR.

## Browser fixtures

The Node scripts under `scripts/verification` launch isolated headless Edge contexts
through `playwright-core`. They intercept native/service responses or install explicit
sample state. Never point a fixture at an everyday app profile or a live service.
They establish renderer behavior, not provider authentication or native execution.

For scripts requiring a preview, start the indicated Vite server in another terminal:

```powershell
pnpm --filter @jackalope/desktop dev --host 127.0.0.1 --port 5191
node scripts/verification/verify-agent-accounts.mjs
```

| Script under scripts/verification | Preview prerequisite | Coverage |
| --- | --- | --- |
| verify-agent-accounts.mjs | Desktop 5191; JACKALOPE_PREVIEW_URL override | Account selection, deletion and recovery |
| verify-agent-sign-in.mjs | Desktop 5297; SIGN_IN_PREVIEW_URL override | Terminal links, cancellation and focus return |
| verify-desktop.mjs | Desktop 5177; create output/growth-redesign first | Task filters, Invitations and appearance |
| verify-learning.mjs | Desktop 5379; LEARNING_PREVIEW_URL override | Lessons, insights, source navigation and appearance |
| verify-orchestration.mjs | Desktop 5391; ORCHESTRATION_PREVIEW_URL override | Coordination UI and explicit capability states |
| verify-worktree-lifecycle.mjs | Desktop 5197; JACKALOPE_VERIFY_URL override | Project attribution, cleanup and merge review |
| verify-settings-sync.mjs | Desktop 5179 | Sync consent, conflicts and theme rollback |
| verify-connected-desktops.mjs | Starts its own website server on 5188 | Device metadata, legacy records and scoped revocation |
| verify-feedback.mjs | Desktop 5297 and website 5296, VITE_ACCESS_API=https://feedback-fixture.invalid | Feedback forms, delivery states and opt-out |
| verify-waitlist.mjs | Website 5198, VITE_ACCESS_API=https://api.jackalope.test | Waitlist, referrals, passes and admin fixtures |
| verify-passes-desktop.mjs | Desktop 5199 | Pass view, clipboard and keyboard |
| performance.mjs --production | Builds and starts its own fixture | History lists, output, rich rendering and production CSP |

Some scripts create temporary entry files and remove them on completion. If one
stops unexpectedly, inspect the leftover fixture before rerunning; do not overwrite
another task's fixture. Keep preview ports isolated from concurrent work.

The website also has Playwright CLI callbacks for media, signup and rendered-route
checks; see its [README](../apps/website/README.md#verification). Desktop callbacks
under `apps/desktop/scripts` complement the regular `*.test.mjs` suites. Read their
fixture prerequisites before invoking them through a Playwright CLI session.

## Native and provider checks

- [Native development](SELF-DEVELOPMENT.md): disposable profiles, process ownership
  and actual window inspection.
- [Agent support](AGENT-SUPPORT.md#run-opt-in-validation): installed CLI lifecycle
  with the selected account/model. Real providers may consume quota.
- [Quality evaluation](AGENT-QUALITY.md): matched native executables and frozen
  prompt fixtures. Retain all failures and missing usage.
- [Execution evaluation](EXECUTION-EVALUATION.md): single/serial/staged task trials.
- [Local setup](LOCAL-AI.md#verification-and-remaining-acceptance): OpenCode protocol
  probe against a fake loopback provider, separate from real Ollama/model acceptance.
- [Platform checks](CROSS-PLATFORM-RELEASES.md#native-checks-on-your-devices): browser
  cleanup, native keyrings, Linux X11 and macOS helper guards.
- [Release acceptance](RELEASE.md): signed artifacts, installed workflows and updates.

Keep automated fixture results, actual device behavior and release acceptance
distinct. An ignored test has not run merely because the surrounding suite passed.
