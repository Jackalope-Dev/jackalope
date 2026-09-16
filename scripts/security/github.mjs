import { spawnSync } from 'node:child_process';
import { requiredChecks } from '../release/source-checks.mjs';

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
const list = (route, property) => {
  const items = [];
  for (let page = 1; ; page++) {
    const response = api(`${route}?per_page=100&page=${page}`);
    const batch = property ? response[property] : response;
    items.push(...batch);
    if (batch.length < 100) return items;
  }
};
const repository = api(prefix);
if (!args.includes('--apply')) {
  console.log(
    JSON.stringify(
      {
        repository: repo,
        visibility: repository.visibility,
        actions: api(`${prefix}/actions/permissions`),
        branch: api(`${prefix}/branches/${repository.default_branch}`).protected,
        branches: api(`${prefix}/branches`).map(({ name, protected: protectedBranch }) => ({
          name,
          protected: protectedBranch,
        })),
        releaseVariables: list(`${prefix}/actions/variables`, 'variables').filter(({ name }) =>
          /^(CLOUD_|STORE_|APPLE_SIGNING_READY|RELEASE_DISTRIBUTION)/.test(name),
        ),
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
for (const workflow of ['desktop-release.yml', 'publish-release.yml']) {
  if (api(`${prefix}/actions/workflows/${workflow}`).state === 'active')
    api(`${prefix}/actions/workflows/${workflow}/disable`, 'PUT');
}
const variables = list(`${prefix}/actions/variables`, 'variables');
for (const [name, value] of Object.entries({
  STORE_AUTOMATION_ENABLED: 'false',
  STORE_SUBMISSION_ENABLED: 'false',
  STORE_ACCEPTED: 'false',
  STORE_BETA_TEST_ENABLED: 'false',
  CLOUD_RELEASE_ENABLED: 'false',
  CLOUD_PUBLISH_ENABLED: 'false',
  CLOUD_DRAFT_UPLOAD_ENABLED: 'false',
  CLOUD_SIGNING_READY: 'false',
  APPLE_SIGNING_READY: 'false',
  CLOUD_RELEASE_TARGETS: '["darwin-aarch64","darwin-x86_64","linux-x86_64"]',
  CLOUD_ACCEPTED_TARGETS: '[]',
  CLOUD_BETA_TEST_TARGETS: '[]',
})) {
  if (!variables.some((variable) => variable.name === name))
    api(`${prefix}/actions/variables`, 'POST', { name, value });
}
const cloudTargets = variables.find(({ name }) => name === 'CLOUD_RELEASE_TARGETS');
if (cloudTargets) {
  const unix = JSON.parse(cloudTargets.value).filter((target) => target !== 'windows-x86_64');
  api(`${prefix}/actions/variables/CLOUD_RELEASE_TARGETS`, 'PATCH', {
    name: 'CLOUD_RELEASE_TARGETS',
    value: JSON.stringify(unix.length ? unix : ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64']),
  });
}
for (const name of ['CLOUD_ACCEPTED_TARGETS', 'CLOUD_BETA_TEST_TARGETS']) {
  const previous = variables.find((variable) => variable.name === name);
  if (previous)
    api(`${prefix}/actions/variables/${name}`, 'PATCH', {
      name,
      value: JSON.stringify(
        JSON.parse(previous.value).filter((target) => target !== 'windows-x86_64'),
      ),
    });
}
const distribution = variables.find(({ name }) => name === 'RELEASE_DISTRIBUTION');
api(
  `${prefix}/actions/variables${distribution ? '/RELEASE_DISTRIBUTION' : ''}`,
  distribution ? 'PATCH' : 'POST',
  { name: 'RELEASE_DISTRIBUTION', value: 'store' },
);
const branches = api(`${prefix}/branches`);
if (!branches.some(({ name }) => name === 'beta'))
  api(`${prefix}/git/refs`, 'POST', {
    ref: 'refs/heads/beta',
    sha: api(`${prefix}/branches/${repository.default_branch}`).commit.sha,
  });
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
for (const branch of new Set([repository.default_branch, 'beta']))
  api(`${prefix}/branches/${branch}/protection`, 'PUT', {
    required_status_checks: {
      strict: true,
      contexts: requiredChecks,
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
    reviewers: name.endsWith('-beta') ? [] : [{ type: 'User', id: user.id }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  });
  const allowed =
    name === 'cloud-beta'
      ? ['beta', repository.default_branch]
      : name === 'store-beta'
        ? ['beta']
        : [repository.default_branch];
  const policies = api(`${prefix}/environments/${name}/deployment-branch-policies`).branch_policies;
  for (const policy of policies) {
    if (policy.type !== 'branch' || !allowed.includes(policy.name))
      api(`${prefix}/environments/${name}/deployment-branch-policies/${policy.id}`, 'DELETE');
  }
  for (const branch of allowed) {
    if (!policies.some((policy) => policy.type === 'branch' && policy.name === branch))
      api(`${prefix}/environments/${name}/deployment-branch-policies`, 'POST', {
        name: branch,
        type: 'branch',
      });
  }
}
const tagRules = api(`${prefix}/rulesets`).find((rule) => rule.name === 'Protect release tags');
if (!tagRules)
  api(`${prefix}/rulesets`, 'POST', {
    name: 'Protect release tags',
    target: 'tag',
    enforcement: 'active',
    conditions: {
      ref_name: {
        include: [
          'refs/tags/beta-v*',
          'refs/tags/stable-v*',
          'refs/tags/store-beta/v*',
          'refs/tags/store-stable/v*',
        ],
        exclude: [],
      },
    },
    rules: [{ type: 'update' }, { type: 'deletion' }],
    bypass_actors: [],
  });
console.log(
  'Release branches and protections configured for Windows Store and Mac/Linux Cloud releases. Existing enablement flags preserved; enable publication only after installed acceptance.',
);
