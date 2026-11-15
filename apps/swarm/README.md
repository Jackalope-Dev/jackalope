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

## Set up from Jackalope

You need a Cloudflare account on the Workers Paid plan with Artifacts, connected in
Settings → Cloudflare. In Settings → Swarm, **Set up Swarm**:

1. checks the account and its workers.dev subdomain (choose one in the dashboard if
   the account has none);
2. uploads the Worker bundled with the app as `jackalope-swarm`, with the Artifacts
   binding pointed at the connected namespace, the `Swarm` Durable Object and its
   migrations, a generated `SWARM_TOKEN` secret (64 random characters kept in
   protected storage) and `SWARM_VERSION`;
3. publishes it at `https://jackalope-swarm.<subdomain>.workers.dev`;
4. waits for `/health` to report the uploaded version, makes an authenticated call
   and saves the connection.

Each step can be retried. Running it again updates the Worker in place and keeps
its token. Settings shows **Update Swarm Worker** when the app bundles a newer
Worker or the connected namespace changes.

Deploying needs Workers access. Connect Cloudflare asks for the
`workers-scripts.write` scope only during Swarm setup, opening the browser once if
the saved sign-in lacks it. An API token needs Account → Workers Scripts → Edit as
well as Artifacts → Edit.

Disconnecting a Worker that Set up Swarm deployed offers **Also delete the Worker
from Cloudflare**, on by default. Deleting it removes the script and its Durable
Object data, so fork tracking stops on every computer using it; Artifacts
repositories are untouched. If Cloudflare refuses (for example, a token without
Workers Scripts → Edit), the connection is still forgotten and Settings links to
the Worker in the dashboard. A Worker entered by hand is only forgotten.

### Use an existing Worker

To deploy it yourself, set the namespace in `wrangler.jsonc` if yours is not
`jackalope`, then:

```sh
pnpm install
cd apps/swarm
npx wrangler login
# Choose a random secret of at least 32 characters and keep it for the desktop.
npx wrangler secret put SWARM_TOKEN
npx wrangler deploy
```

Choose **Use an existing Worker** and enter its URL and the same token. Projects
linked to Artifacts then sync every 15 seconds while tasks run; open Project →
Swarm to watch.

## API

Every route except `/health` requires `Authorization: Bearer <SWARM_TOKEN>`.
`/health` returns `{ok, version}`, where `version` is the `SWARM_VERSION` that
one-click setup uploaded, or `null`.
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
pnpm --filter @jackalope/swarm bundle     # refresh the copy the desktop embeds
pnpm check:swarm-bundle                   # fails when that copy is stale
```

The desktop embeds `apps/desktop/src-tauri/resources/swarm-worker/worker.js` and
`manifest.json` (compatibility date, bindings, migrations and a content version).
Run the bundle script after changing `src/` or `wrangler.jsonc` and commit both files.

Tests use an in-memory Git object store; they do not reach Cloudflare.
