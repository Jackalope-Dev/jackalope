# Deployment and source boundaries

The monorepo contains the desktop, website, optional service and shared branding.
Source visibility is independent of permission to operate a deployment or publish
an official signed desktop release.

## Deployment units

| Source | Deployment boundary |
| --- | --- |
| `apps/website` | Static, prerendered website assets; no server credentials |
| `apps/server` | Optional Worker, D1 migrations and R2 update delivery |
| `apps/desktop` | Native desktop and embedded frontend, packaged per platform |
| `packages/brand` | Shared tokens, geometry, fonts and their notices |

Configure your own domains, account/resource identifiers and secrets outside
source. The checked-in server configuration uses placeholders; generated
deployment configuration is ignored. Keep staging and production resources and
secrets separate. Review migrations before applying them remotely.

Choose one automatic deployment controller per environment. Cloudflare Workers
Builds and the optional GitHub deployment workflows must not deploy the same
Worker concurrently. A configured connection is not proof of a successful deploy.
See [release automation](RELEASE-AUTOMATION.md) and the
[server runbook](SERVER-LAUNCH.md) for validation boundaries.

Local website builds do not require private service credentials. Public API URLs,
signup action identifiers and updater verification keys are intentionally public.
Private signing keys, API tokens, deploy-hook URLs, account exports, feedback,
telemetry databases and diagnostic bundles must stay outside the repository.

## Verification

Run `pnpm verify` and `pnpm check:secrets` before distributing source. Secret
scanning does not verify image contents, asset rights or hosted logs/artifacts.
Independently verify routing, readiness, retention and authorization against the
selected environment. For desktop publication, follow [RELEASE.md](RELEASE.md);
a frontend build is not installed-app acceptance.

The website's content, metadata, sitemap, RSS and supplemental LLM-readable indexes
are generated together. Search-engine ownership tokens and indexing administration
belong in the operator's account, not in generic source defaults.
