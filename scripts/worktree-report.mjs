// Worktree hygiene. Lists every worktree with its state so stale ones stop
// confusing agents about the baseline.
//   node scripts/worktree-report.mjs                  report only
//   node scripts/worktree-report.mjs --remove-merged  also remove worktrees that are
//     clean (no uncommitted changes) and whose branch is merged into the default branch
// Always runs `git worktree prune` (drops entries whose directory is already gone).
// Never touches a worktree with uncommitted work, a locked worktree, or the main checkout.
// Canonical copy: jackalope-digital-hub/templates/scripts/worktree-report.mjs
import { execFileSync } from 'node:child_process';

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (args, cwd) => {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
};

const remove = process.argv.includes('--remove-merged');
git(['worktree', 'prune']);
const head = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']) ?? 'origin/main';
const entries = git(['worktree', 'list', '--porcelain']).split('\n\n').filter(Boolean);
const [main, ...rest] = entries.map((block) => {
  const field = (k) =>
    block
      .split('\n')
      .find((l) => l.startsWith(`${k} `))
      ?.slice(k.length + 1);
  return {
    path: field('worktree'),
    branch: field('branch')?.replace('refs/heads/', '') ?? '(detached)',
    locked: block.includes('\nlocked'),
  };
});

const rows = [];
for (const wt of rest) {
  const dirty = (tryGit(['status', '--porcelain'], wt.path) ?? '?').length > 0;
  const headSha = tryGit(['rev-parse', 'HEAD'], wt.path);
  const merged = headSha ? tryGit(['merge-base', '--is-ancestor', headSha, head]) !== null : false;
  const age = Math.round(
    (Date.now() / 1000 - Number(tryGit(['log', '-1', '--format=%ct'], wt.path) ?? 0)) / 86400,
  );
  let action = '';
  if (remove && merged && !dirty && !wt.locked) {
    git(['worktree', 'remove', wt.path]);
    action = 'removed';
  }
  rows.push({ ...wt, dirty, merged, age, action });
}

console.log(`main checkout: ${main.path} [${main.branch}]  default: ${head}`);
for (const r of rows.sort((a, b) => b.age - a.age)) {
  const flags = [
    r.dirty ? 'DIRTY' : 'clean',
    r.merged ? 'merged' : 'unmerged',
    r.locked && 'locked',
    r.action,
  ]
    .filter(Boolean)
    .join(', ');
  console.log(`${String(r.age).padStart(4)}d  ${r.branch.padEnd(48)} ${flags}  ${r.path}`);
}
const stale = rows.filter((r) => r.merged && !r.dirty && !r.locked && !r.action).length;
if (stale && !remove)
  console.log(`\n${stale} clean, merged worktree(s) can go: rerun with --remove-merged`);
