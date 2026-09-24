---
name: jackalope-release
description: Prepare Jackalope beta or stable release cuts, version bumps and release notes, or inspect release pipeline readiness. Use for desktop release preparation and promotion while master continues development.
---

# Jackalope release preparation

Read [release automation](../../../docs/RELEASE-AUTOMATION.md) for the maintained
commands, branch policies, gates and recovery procedure. Follow repository AGENTS.md
and [verification guidance](../../../CONTRIBUTING.md). Leave code commits to the maintainer.

`master` is development, `beta` is prerelease and `stable` is production. Use
`pnpm release:cut beta patch` for current remote master or
`pnpm release:cut stable patch SOURCE` for a tested beta SHA/tag. The stable default
is current remote beta; confirm that snapshot has the intended acceptance evidence
before describing it as tested. Choose a minor/major bump or explicit version when
the request calls for it. Do not cut from uncommitted development or silently include
new master changes in a beta-to-stable promotion.

Work in the printed isolated checkout. Review the source/destination SHAs and merged
diff, resolve conflicts without discarding release fixes, and write user-facing notes
from actual changes since the previous channel release. The helper selects a numeric
version above known releases for Store upgrade ordering. Never reuse or move a reserved tag.
For conflict recovery, use the printed `release:prepare VERSION --merged` command only
after resolving and staging the merge and reconciling existing version fields.

Run the guide's checks; leave a reviewable diff and exact maintainer commit/push or
PR instructions. Do not commit, push, submit packages, enable gates or approve deployments
as an implied part of preparation. Inspect live settings read-only with
`pnpm release:setup` when readiness is requested. Infrastructure setup or publication
requires the corresponding user instruction; keep missing account/acceptance requirements explicit.

Windows uses Store submissions; Mac/Linux use Cloud publication. Source tests and
unsigned packaging do not establish signing, Store certification, public availability
or installed update acceptance. For failed publication inspect the original run and
receipts, and follow recovery using its original artifacts. Stop on uncertain remote
state rather than deleting drafts or rebuilding a reserved version.
