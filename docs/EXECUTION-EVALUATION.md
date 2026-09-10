# Execution quality and evaluation

Feature planning inspects the repository before proposing ownership and dependencies.
The default unspecialized draft keeps one worker and the complete request. Every
saved feature task retains that full request alongside its assigned instructions.
Automatic routing checks native policy and quota at launch; UI recommendations no
longer assign specialties from agent names. A sole eligible native candidate skips
the routing model call. Historical project/model outcome counts supplement routing;
they do not establish causal superiority or a specialty from a small sample.

## Parallel work and evidence

Queue admission favors longer remaining dependency paths and balances active work
across projects. Finishing attempts retain workspace ownership while releasing the
agent slot. Preparation and verification commands share a separate two-command limit. They reserve
their own canonical workspace, release the global execution guard while running,
and retain before/after file snapshots. Launch, integration, previews, cleanup,
reset and updates honor those reservations. Checks remain cancelable for active
attempts. Existing same-command, same-snapshot reuse is preserved.

The planner optionally enables **verified predecessor snapshots**. It requires a
saved project check and automatic verification. Each dependent worktree begins from
retained Git objects combining its verified predecessors with the target branch.
Sources and the target checkout are unchanged. Receipts retain ancestor run IDs,
HEADs, content trees and index/worktree state. Conflicts block dispatch. Changed,
retried, active, interrupted or unavailable predecessors block continuation and
integration. Retain predecessor workspaces until combined review is complete.

Final review selects all predecessors and descendants together and still requires
ordinary outcome acceptance and verification. **Add independent review** adds a
fresh worker over the combined feature; its findings remain agent claims until
reviewed. Staging is not automatic acceptance or a source-worktree sandbox.

## Coordination

The shared `message` tool and HTTP endpoint accept `dependency`, `interface`,
`waiting` and `completion`, in addition to the existing message kinds. An optional
`report` contains bounded `completed`, `remaining` and relative `artifacts` lists;
native code attaches the attempt and current file snapshot. These reports do not
prove the claims or execute artifacts. `resolves` identifies a message answered by
its author or addressed recipient. Resolution, read acknowledgment and acceptance
are distinct. All fields are optional for older journals and clients.

`inbox` accepts `wait_ms` up to 30,000. It waits without a model turn and checks
authorization throughout, returning on messages, expired cursors or timeout. Empty
pages preserve the cursor. Existing tool-boundary update delivery remains enabled.
Provider-native shell calls do not automatically receive bridge messages; workers
must use the inbox at checkpoints. Arbitrary mid-turn steering is not claimed for
CLI adapters without a verified protocol for it.

## Measurements

Native journals record preparation, routing, execution, verification waiting,
verification and checkpoint stages. Performance & insights displays summed work
time and copies local evaluation data without prompts, answers or account labels.
Parallel stages overlap in wall time. Interrupted stages have no completed timing;
older records remain unmeasured. Follow-ups are not automatically corrections.
Human acceptance uses saved outcome receipts, not successful agent exits.

Run `pnpm evaluate:execution` to inspect the evaluation plan without launching agents.
To execute installed Codex trials in new disposable repositories/profiles:

```powershell
pnpm evaluate:execution -- --execute '--case=small-fix,layered-feature' --repeat=3 --seconds=300 --tokens=1000000
```

Modes are `single`, `serial` and `staged`; select a subset with `'--modes=single,staged'`.
The driver builds once and runs a private executable copy for consistent comparisons
and to avoid locking the shared Windows test binary. It rotates mode order across repetitions. Each trial retains native journals,
stage timings, usage, its independent behavioral oracle, limits and failures.
Comparisons are saved under `scratch/execution-evaluation`. Profiles are retained
under the OS temporary directory; their full journals can contain task/account data.
The suite covers boundary fixes and a feature with independent helpers and an
integration step. Existing native regression suites separately exercise quota
handoff, restart, cancellation, message permissions and stale/conflicting snapshots.

Keep the installed provider/model, repository fixture and budgets constant when
comparing variants. Serial trials integrate immediately and therefore exclude real
human review delays. Token stopping counts reported input and output, including cached input reported
by the provider. A model may report usage only at turn completion. It cannot enforce a hard
provider spending limit. Human review minutes, acceptance and escaped defects need
an independent reviewer and remain unknown in automated receipts. A passing oracle
is not product acceptance. Repeat trials before claiming a speed or quality gain.

## Local validation — September 10, 2026

Browser fixtures passed at 1280×840 and 960×640 in both themes with reduced motion,
including full request retention, staged import, independent review, focus return,
timing display and sanitized evaluation copying. These are browser-only checks.

Installed Codex smoke runs retained budget failures rather than treating agent output
as acceptance. The staged trial verified both helper worktrees and launched the final
worker with both dependency receipts, then reached its 300-second limit. The retained
incomplete result did not pass the behavioral oracle. Initial single and serial trials
hit their 100,000 reported-token limit. These runs establish neither a quality gain nor
a speed ranking; repeated completed trials and installed-app acceptance remain open.
