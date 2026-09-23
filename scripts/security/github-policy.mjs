import { requiredChecks } from '../release/source-checks.mjs';

export const allowedActions = {
  github_owned_allowed: false,
  verified_allowed: false,
  patterns_allowed: [
    'actions/cache@*',
    'actions/checkout@*',
    'actions/download-artifact@*',
    'actions/setup-dotnet@*',
    'actions/setup-node@*',
    'actions/upload-artifact@*',
    'azure/login@*',
    'github/codeql-action/*@*',
    'pnpm/action-setup@*',
  ],
};

export const environmentPolicies = {
  'cloud-beta': { branches: ['beta', 'stable'], approval: false },
  'cloud-stable': { branches: ['stable'], approval: true },
  'store-beta': { branches: ['beta'], approval: false },
  'store-stable': { branches: ['stable'], approval: true },
  'service-staging': { branches: ['beta'], approval: false },
  'service-production': { branches: ['master'], approval: true },
};

export function branchProtection(reviewer) {
  return {
    required_status_checks: {
      strict: true,
      checks: requiredChecks.map((context) => ({ context, app_id: 15368 })),
    },
    enforce_admins: false,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      require_last_push_approval: true,
      required_approving_review_count: 1,
      dismissal_restrictions: { users: [reviewer], teams: [] },
    },
    restrictions: { users: [reviewer], teams: [], apps: [] },
    required_conversation_resolution: true,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

export function environmentProtection(policy, reviewerId, previous = {}) {
  return {
    wait_timer:
      previous.protection_rules?.find((rule) => rule.type === 'wait_timer')?.wait_timer ?? 0,
    prevent_self_review: false,
    can_admins_bypass: false,
    reviewers: policy.approval ? [{ type: 'User', id: reviewerId }] : [],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  };
}

export function managedRulesets(defaultBranch) {
  return [
    {
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
    },
    {
      name: 'Preserve protected branch history',
      target: 'branch',
      enforcement: 'active',
      conditions: {
        ref_name: {
          include: [...new Set([defaultBranch, 'beta', 'stable'])].map((b) => `refs/heads/${b}`),
          exclude: [],
        },
      },
      rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }],
      bypass_actors: [],
    },
  ];
}
