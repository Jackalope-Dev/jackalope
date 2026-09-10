# Local agents and model-free context selection

Local setup is implemented in source and awaits installed-app acceptance with real
models. No inference runtime, weights or tokenizer are bundled with Jackalope.
The optional setup uses OpenCode and Ollama; it does not require an AI provider
subscription. Jackalope's account-access requirement remains separate.

## Guided setup

Open **Agents → Try a local agent**, or use the same entry during onboarding.

1. Inspect total/available system memory, graphics names and free disk space on
   the expected model drive. Unknown values stay unknown. GPU detection does not
   establish acceleration or usable VRAM.
2. Review an optional model download and its memory guidance. Sizes are approximate
   upstream tag sizes; tags and packages can change.
3. Install Ollama and OpenCode, then explicitly start the model download. Windows
   offers WinGet buttons for `Ollama.Ollama` and `SST.opencode`, with official
   downloads as a fallback. macOS/Linux use the official setup links. Open Ollama
   and recheck if its local service is not running. WinGet may require system
   approval or a restart; stopping it cannot roll back completed installations.
   Download and installer progress, elapsed time, cancellation and failures appear
   within the selected tool or model row. A quiet installer does not report a percentage;
   its elapsed time stays visible until it finishes or reaches the installation timeout.
4. Run the local check. Jackalope creates an Ollama alias with a 65,536-token
   context, asks OpenCode to edit a file in an owned disposable folder, and
   continues the same session to create a second file. A matching session ID,
   tool event, exact file contents and unchanged base/alias digests are required.
   Only then can the user connect the account. Cancellation invalidates the check.

| Optional model | Approximate download | Suggested system memory |
| --- | ---: | ---: |
| Qwen 3.5 4B | 3.4 GB | 16 GB |
| Qwen 3.5 9B | 6.6 GB | 24 GB |
| Qwen3 Coder 30B | 19 GB | 48 GB |

Memory figures are conservative starting points, **not measured acceptance
thresholds or speed guarantees**. Context, GPU memory and other apps affect
whether a model fits. Ollama's Windows documentation also requires at least
4 GB for its runtime, separate from weights. The OpenCode installer selects the current package; its size and dependencies
can change.

Model requests use `127.0.0.1:11434`. Native download requests bypass proxies and
redirects. Download progress comes from Ollama's layer byte counts; totals remain
indeterminate until reported. Closing setup cancels its current operation. Ollama
retains reusable layers, and tools/models remain installed when setup is skipped.
The prepared alias shares weight layers with its base model. To reclaim those
layers, remove both models in Ollama. Owned check folders are removed after the
check; a locked leftover may remain under the native profiles `local-checks` directory.

Connecting creates or reuses a named OpenCode account and selects it for future
OpenCode work. It preserves other accounts and their model preferences. Onboarding
pins the chosen local account to the pending project. Outside onboarding, choose
the account in project settings. Finishing local setup refreshes agent detection and
selects OpenCode and the new local account in onboarding, including after a reload.
If the app's default agent is unavailable,
setup selects OpenCode for Ask Jackalope. Existing sessions retain their saved
account; model and account restrictions still apply.

Both OpenCode's main model and `small_model` point to the same checked local
model. The profile enables only its local provider, disables sharing and project
configuration overrides, and removes inherited external configuration paths.
Per-task permissions and Jackalope's direct MCP configuration are retained.
This is a local inference configuration, not an OS sandbox: agent tools, package
installation, enterprise-managed OpenCode configuration and external services
have their own boundaries. The file check establishes basic tool/session support,
not coding quality, offline installation or suitability for every task.

Sources: [Ollama and OpenCode](https://docs.ollama.com/integrations/opencode),
[Windows requirements](https://docs.ollama.com/windows),
[Qwen 3.5 tags](https://ollama.com/library/qwen3.5),
[Qwen3 Coder](https://ollama.com/library/qwen3-coder),
[OpenCode configuration](https://opencode.ai/docs/config/).

## Context retrieval and routing

- Ask Jackalope receives up to four relevant, complete documentation passages
  with sources, bounded to about 6 KB. It can answer from sufficient excerpts
  without a search/read round trip, or request full documents when necessary.
  Search tools use BM25 too; partial retrieval is never treated as proof of an answer.
- Routing shares repeated account metadata while retaining every eligible model
  and every original candidate field. It preserves the full task, saved context,
  and acceptance criteria. Quality and task fit precede
  headroom among capable models; being small, free or local does not establish fit.
- Local profiles expose only their checked model, and other accounts keep their
  model choices. Explicit assignments, restrictions, quota reserves and handoff
  eligibility remain enforced. The existing one-candidate path uses no routing call.

Candidate packing preserves every original field exactly. Prompt size and retrieval
coverage do not establish billed-token savings or coding quality.

## Verification and remaining acceptance

The optional [OpenCode protocol probe](../scripts/verification/local-opencode.mjs)
runs a real OpenCode executable against an explicitly fake loopback provider:

```powershell
node scripts/verification/local-opencode.mjs path/to/opencode.exe
```

The probe checks CLI configuration, tool events and session compatibility against
a fake provider; it does not run Ollama or real weights.
Native tests cover account isolation, model restrictions, cancellation ownership,
download parsing and lossless prompt packing. Browser fixtures explicitly disable
installation, downloads and connection.

Before release, test the packaged app with current Ollama/OpenCode and each offered
model on representative Windows hardware; record peak RAM/VRAM, latency, tool
reliability, continuation and quality on reviewed tasks. Exercise cancellation,
restart, low disk, unavailable services and installer failures. macOS/Linux setup
and effective enterprise configuration need separate acceptance. Keep routing
quality and real token measurements distinct from retrieval metrics.
