import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const repo = args.includes('--repo') ? value('--repo') : '';
const reviewer = args.includes('--reviewer') ? value('--reviewer') : '';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w-]+$/.test(reviewer))
  throw new Error(
    'Usage: node scripts/security/github.mjs --repo OWNER/REPO --reviewer LOGIN [--apply]',
  );
const api = (route, method = 'GET', body) => {
  const result = spawnSync(
    'gh',
    ['api', route, '--method', method, ...(body ? ['--input', '-'] : [])],
    { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${method} ${route}: ${result.stderr || result.stdout}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const prefix = `repos/${repo}`;
const repository = api(prefix);
if (!args.includes('--apply')) {
  console.log(
    JSON.stringify(
      {
        repository: repo,
        visibility: repository.visibility,
        actions: api(`${prefix}/actions/permissions`),
        branch: api(`${prefix}/branches/${repository.default_branch}`).protected,
        environments: api(`${prefix}/environments`).environments.map(
          ({ name, protection_rules }) => ({ name, protection_rules }),
        ),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (repository.visibility !== 'public')
  throw new Error(
    'Keep the repository private until reviewed source is pushed. GitHub requires an eligible paid plan or public visibility for these protection rules; this command does not change visibility.',
  );
const user = api(`users/${reviewer}`);
const actions = api(`${prefix}/actions/permissions`);
api(`${prefix}/actions/permissions`, 'PUT', {
  enabled: actions.enabled,
  allowed_actions: actions.allowed_actions,
  sha_pinning_required: true,
});
api(`${prefix}/actions/permissions/workflow`, 'PUT', {
  default_workflow_permissions: 'read',
  can_approve_pull_request_reviews: false,
});
api(`${prefix}/actions/permissions/fork-pr-contributor-approval`, 'PUT', {
  approval_policy: 'all_external_contributors',
});
api(`${prefix}/vulnerability-alerts`, 'PUT');
api(`${prefix}/automated-security-fixes`, 'PUT');
api(`${prefix}/private-vulnerability-reporting`, 'PUT');
api(prefix, 'PATCH', {
  security_and_analysis: {
    secret_scanning: { status: 'enabled' },
    secret_scanning_push_protection: { status: 'enabled' },
  },
});
api(`${prefix}/branches/${repository.default_branch}/protection`, 'PUT', {
  required_status_checks: {
    strict: true,
    contexts: [
      'verify',
      'dependencies',
      'secrets',
      'Verify ubuntu-22.04',
      'Verify ubuntu-24.04',
      'Verify macos-15',
      'Verify macos-15-intel',
    ],
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: true,
    required_approving_review_count: 1,
  },
  restrictions: null,
  required_conversation_resolution: true,
  allow_force_pushes: false,
  allow_deletions: false,
});
for (const name of ['cloud-beta', 'cloud-stable', 'store-beta', 'store-stable']) {
  const previous = api(`${prefix}/environments/${name}`);
  api(`${prefix}/environments/${name}`, 'PUT', {
    wait_timer:
      previous.protection_rules.find((rule) => rule.type === 'wait_timer')?.wait_timer ?? 0,
    prevent_self_review: false,
    reviewers: [{ type: 'User', id: user.id }],
    deployment_branch_policy: previous.deployment_branch_policy,
  });
}
console.log(
  'Repository protections applied. Verify environment-scoped secrets before enabling release workflows.',
);
