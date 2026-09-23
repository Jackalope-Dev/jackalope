import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';

const id = process.env.CANDIDATE_RUN;
const branch = process.env.GITHUB_REF_NAME;
const repo = process.env.GITHUB_REPOSITORY;
if (!/^\d+$/.test(id ?? '') || !['beta', 'stable'].includes(branch))
  throw new Error('Select a completed candidate run from beta or stable');
const api = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', `repos/${repo}/${path}`], { encoding: 'utf8', windowsHide: true }),
  );
const run = api(`actions/runs/${id}`);
if (
  run.conclusion !== 'success' ||
  run.head_branch !== branch ||
  run.path !== '.github/workflows/cloud-release.yml' ||
  !['push', 'workflow_dispatch'].includes(run.event) ||
  run.repository.full_name !== repo
)
  throw new Error(
    'Expected a successful Cloud candidate run from this release branch and repository',
  );
const comparison = api(`compare/${run.head_sha}...${branch}`);
if (!['ahead', 'identical'].includes(comparison.status))
  throw new Error('Candidate source is not in this release branch');
await appendFile(process.env.GITHUB_ENV, `EXPECTED_SOURCE=${run.head_sha}\n`);
