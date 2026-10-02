# Jackalope Swarm

A Cloudflare Worker that lets many agents change one repository at the same time.
Every agent attempt works in its own [Artifacts](https://developers.cloudflare.com/artifacts/)
fork. After each push, the Worker diffs the fork against the commit the attempt
started from and compares it with every other active fork, so overlapping edits
show up while agents are still working, including agents on different machines.

The Jackalope desktop app drives it for projects linked to Artifacts: it pushes
each running attempt's checked snapshot to that attempt's fork, asks the Worker
to re-analyze, and shows forks and conflicts on the Swarm page.

## How it works

- One Durable Object per base repository serializes analysis and holds the state.
- `POST /forks` creates a fork through the Artifacts binding and returns a
  write token. The fork is named `<repo>--<attempt>`.
- Analysis reads commits and trees through the binding and walks only subtrees
  whose hashes changed, so cost follows the size of a change, not the repository.
- Files changed by two forks are compared line by line against their shared base.
  Edits to the same or adjacent lines, a delete against an edit, and two different
  new files at one path are reported. Binary, very large or differently based files
  are reported as a shared change rather than compared.
- Subscribers receive state over a hibernating WebSocket.

The Worker never merges. Jackalope keeps review and integration on the person's
machine through its existing guarded merge.

## Deploy to your account

You need a Cloudflare account on the Workers Paid plan with Artifacts, and an
Artifacts namespace (Jackalope uses `jackalope` by default; change it in
`wrangler.jsonc` if yours differs).

```sh
pnpm install
cd apps/swarm
npx wrangler login
# Choose a random secret of at least 32 characters and keep it for the desktop.
npx wrangler secret put SWARM_TOKEN
npx wrangler deploy
```

In Jackalope, open Settings → Connected work → Jackalope Swarm and enter the
Worker URL and the same token. Projects linked to Artifacts then sync every 15
seconds while tasks run; open Project → Swarm to watch.

## API

Every route except `/health` requires `Authorization: Bearer <SWARM_TOKEN>`.
A WebSocket client that cannot set headers may send the subprotocol `swarm.<SWARM_TOKEN>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/v1/swarms/:repo` | Forks, changed files and conflicts |
| `GET` | `/v1/swarms/:repo/live` | WebSocket of state changes |
| `POST` | `/v1/swarms/:repo/forks` | Fork for an attempt: `{attemptId, baseCommit, agent, title}` |
| `POST` | `/v1/swarms/:repo/forks/:fork/analyze` | Re-read a fork after a push |
| `POST` | `/v1/swarms/:repo/forks/:fork/token` | New write token (tokens last a day) |
| `DELETE` | `/v1/swarms/:repo/forks/:fork?delete=1` | Stop tracking and delete a fork |

## Development

```sh
pnpm --filter @jackalope/swarm test       # diff, tree walk, conflicts and access
pnpm --filter @jackalope/swarm typecheck
pnpm --filter @jackalope/swarm build      # dry-run bundle
```

Tests use an in-memory Git object store; they do not reach Cloudflare.
