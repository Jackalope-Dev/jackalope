import { spawnSync } from 'node:child_process';
import {
  allowedActions,
  branchProtection,
  environmentPolicies,
  environmentProtection,
  managedRulesets,
} from './github-policy.mjs';

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
  const actions = api(`${prefix}/actions/permissions`);
  const branches = list(`${prefix}/branches`);
  const environments = list(`${prefix}/environments`, 'environments');
  const optional = (route) => {
    try {
      return api(route);
    } catch (error) {
      return { unavailable: error.message };
    }
  };
  const organization =
    repository.owner.type === 'Organization' ? optional(`orgs/${repository.owner.login}`) : null;
  const installations = organization
    ? optional(`orgs/${repository.owner.login}/installations?per_page=100`)
    : null;
  console.log(
    JSON.stringify(
      {
        repository: repo,
        visibility: repository.visibility,
        actions,
        allowedActions:
          actions.allowed_actions === 'selected'
            ? api(`${prefix}/actions/permissions/selected-actions`)
            : null,
        workflowPermissions: api(`${prefix}/actions/permissions/workflow`),
        externalContributorApproval: api(
          `${prefix}/actions/permissions/fork-pr-contributor-approval`,
        ),
        security: repository.security_and_analysis,
        organization: organization && {
          defaultPermission: organization.default_repository_permission,
          requiresTwoFactor: organization.two_factor_requirement_enabled,
          unavailable: organization.unavailable,
        },
        organizationApps:
          installations?.installations?.map((installation) => ({
            app: installation.app_slug,
            repositorySelection: installation.repository_selection,
            permissions: installation.permissions,
            repositoryAccess:
              installation.repository_selection === 'all'
                ? 'included'
                : 'review selected repositories',
          })) ?? installations,
        collaborators: list(`${prefix}/collaborators`).map(({ login, role_name }) => ({
          login,
          role: role_name,
        })),
        invitations: list(`${prefix}/invitations`).map(({ id, invitee, permissions }) => ({
          id,
          login: invitee?.login,
          permissions,
        })),
        deployKeys: list(`${prefix}/keys`).map(({ id, title, read_only }) => ({
          id,
          title,
          readOnly: read_only,
        })),
        runners: api(`${prefix}/actions/runners`).runners.map(({ name, os, status }) => ({
          name,
          os,
          status,
        })),
        repositorySecrets: list(`${prefix}/actions/secrets`, 'secrets').map(({ name }) => name),
        branches: branches.map(({ name, protected: protectedBranch }) => ({
          name,
          protected: protectedBranch,
          protection: protectedBranch ? api(`${prefix}/branches/${name}/protection`) : null,
        })),
        rulesets: list(`${prefix}/rulesets`).map(({ id }) => api(`${prefix}/rulesets/${id}`)),
        releaseVariables: list(`${prefix}/actions/variables`, 'variables').filter(({ name }) =>
          /^(CLOUD_|STORE_|APPLE_SIGNING_READY|RELEASE_DISTRIBUTION)/.test(name),
        ),
        environments: environments.map(({ name }) => {
          const environment = api(`${prefix}/environments/${name}`);
          return {
            name,
            canAdminsBypass: environment.can_admins_bypass,
            protectionRules: environment.protection_rules,
            branches: list(
              `${prefix}/environments/${name}/deployment-branch-policies`,
              'branch_policies',
            ),
            secrets: list(`${prefix}/environments/${name}/secrets`, 'secrets').map(
              ({ name: secretName }) => secretName,
            ),
          };
        }),
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
const branches = list(`${prefix}/branches`);
for (const branch of ['beta', 'stable']) {
  if (!branches.some(({ name }) => name === branch))
    api(`${prefix}/git/refs`, 'POST', {
      ref: `refs/heads/${branch}`,
      sha: api(`${prefix}/branches/${repository.default_branch}`).commit.sha,
    });
}
const actions = api(`${prefix}/actions/permissions`);
api(`${prefix}/actions/permissions`, 'PUT', {
  enabled: actions.enabled,
  allowed_actions: 'selected',
  sha_pinning_required: true,
});
api(`${prefix}/actions/permissions/selected-actions`, 'PUT', allowedActions);
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
for (const branch of new Set([repository.default_branch, 'beta', 'stable']))
  api(`${prefix}/branches/${branch}/protection`, 'PUT', branchProtection(reviewer));
const environments = list(`${prefix}/environments`, 'environments');
for (const [name, policy] of Object.entries(environmentPolicies)) {
  const previous = environments.find((environment) => environment.name === name);
  api(`${prefix}/environments/${name}`, 'PUT', environmentProtection(policy, user.id, previous));
  const allowed = policy.branches;
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
const rulesets = list(`${prefix}/rulesets`);
for (const desired of managedRulesets(repository.default_branch)) {
  const previous = rulesets.find((rule) => rule.name === desired.name);
  api(`${prefix}/rulesets${previous ? `/${previous.id}` : ''}`, previous ? 'PUT' : 'POST', desired);
}
console.log(
  'Release branches and protections configured for Windows Store and Mac/Linux Cloud releases. Existing enablement flags preserved; enable publication only after installed acceptance.',
);
