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

Before cutting, check the source's CI with `gh run list --branch master`: Cloud
publication requires every Verify job (`scripts/release/source-checks.mjs`), so a red
master or beta run blocks the release. A stable cut from beta conflicts only in the five
version files (stable's old version against beta's); take beta's side, confirm the staged
tree matches the beta tag apart from stable-only release notes, then run
`release:prepare VERSION --merged`.

Release notes are what users see after updating, so cover everything since the version
that channel's users last received. A platform whose previous publication failed skips
that version, and stable promotions span several betas. Read earlier `releases/*.md` and
the public changelog rather than only the latest commits.

Run the guide's checks; leave a reviewable diff and exact maintainer commit/push or
PR instructions. Give commands with absolute worktree paths (`git -C /abs/path ...`) so
they work from any directory.

After the maintainer pushes, watch that branch's Verify platforms, Security checks,
Store release and Cloud release runs. Inspect every failure log before acting. Rerun
only a failed job whose cause is known runner timing (`gh run rerun ID --failed`), such
as the Linux desktop-control or Windows terminal-exit tests. A Cloud release that stops
with "Source checks are not ready" ran before CI finished; rerun its failed job once
Verify is green. It reuses the original candidate artifacts. Confirm the
`CHANNEL-vVERSION` tag after publication, and report which acceptance remains open. Do not commit, push, submit packages, enable gates or approve deployments
as an implied part of preparation. Inspect live settings read-only with
`pnpm release:setup` when readiness is requested. Infrastructure setup or publication
requires the corresponding user instruction; keep missing account/acceptance requirements explicit.

Windows uses Store submissions; Mac/Linux use Cloud publication. Source tests and
unsigned packaging do not establish signing, Store certification, public availability
or installed update acceptance. For failed publication inspect the original run and
receipts, and follow recovery using its original artifacts. Stop on uncertain remote
state rather than deleting drafts or rebuilding a reserved version.
