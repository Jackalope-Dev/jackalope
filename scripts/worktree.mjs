// Worktrees, and keeping the local default branch current.
//   node scripts/worktree.mjs new <task> [branch]   sync, then add .worktrees/<task> on a new branch
//   node scripts/worktree.mjs sync                  fast-forward the local default branch to origin
//
// `sync` fetches and fast-forwards the default branch (only ever a fast-forward:
// it never resets, stashes or overwrites, and git refuses one that would touch
// local edits), then reinstalls the main checkout if its lockfile changed since
// the last install. Run it after you push to the default branch or a PR merges.
//
// `new` syncs first, so the branch starts from current code, then adds the
// worktree and copies the main checkout's small gitignored files into it: env
// files (.env*, .dev.vars) and generated ones (cloudflare-env.d.ts,
// next-env.d.ts, manifests) that a fresh checkout lacks and typecheck needs.
// Installing:
// - Single-package repo: no install. Node and bun resolve packages by walking up
//   the folder tree, so .worktrees/<task> uses the main checkout's node_modules,
//   which sync has just matched to the same lockfile. Installs only if the
//   lockfiles differ.
// - Workspace monorepo (package.json "workspaces" or pnpm-workspace.yaml):
//   always installs in the worktree. node_modules there links each workspace
//   package to the main checkout's copy, so sharing it would run the main
//   checkout's packages instead of the worktree's edits.
// Canonical copy: jackalope-digital-hub/templates/scripts/worktree.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const LOCKFILES = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
const STAMP = join('node_modules', '.worktree-lock-stamp');
// Never copied: logs, build caches and OS files.
const SKIP_FILE = /(\.log|\.tsbuildinfo|\.DS_Store|Thumbs\.db)$/i;
const MAX_COPY_BYTES = 1024 * 1024;

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (args, cwd) => {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
};
// stdout without console.log, which some repos' lint config bans.
const log = (msg) => process.stdout.write(`${msg}\n`);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// Always the main checkout, even when run from inside a worktree.
const main = dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
const base =
  tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], main)?.replace(/^origin\//, '') ??
  (tryGit(['rev-parse', '--verify', '--quiet', 'refs/heads/main'], main) ? 'main' : 'master');

function packageManager(dir) {
  try {
    const pm = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).packageManager;
    if (pm) return pm.split('@')[0];
  } catch {}
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun';
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  return 'npm';
}

function isWorkspace(dir) {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true;
  try {
    return Boolean(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).workspaces);
  } catch {
    return false;
  }
}

function lockHash(dir) {
  const h = createHash('sha256');
  for (const f of LOCKFILES)
    if (existsSync(join(dir, f))) h.update(f).update(readFileSync(join(dir, f)));
  return h.digest('hex');
}

function install(dir) {
  if (!existsSync(join(dir, 'package.json'))) return;
  const pm = packageManager(dir);
  const args = pm === 'npm' ? ['ci'] : ['install', '--frozen-lockfile'];
  log(`\n${pm} ${args.join(' ')} in ${dir}`);
  const r = spawnSync(pm, args, {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) fail(`${pm} install failed in ${dir}.`);
  writeFileSync(join(dir, STAMP), lockHash(dir));
}

function sync() {
  if (tryGit(['fetch', '--quiet', 'origin', base], main) === null) {
    console.warn(`Could not fetch origin/${base}; leaving the local ${base} as it is.`);
    return;
  }
  const checkedOut = git(['branch', '--show-current'], main);
  const before = tryGit(['rev-parse', base], main);
  const r =
    checkedOut === base
      ? spawnSync('git', ['merge', '--ff-only', '--quiet', `origin/${base}`], {
          cwd: main,
          encoding: 'utf8',
        })
      : // Not checked out anywhere: move the ref, still only if it fast-forwards.
        spawnSync('git', ['fetch', '--quiet', 'origin', `${base}:${base}`], {
          cwd: main,
          encoding: 'utf8',
        });
  const after = tryGit(['rev-parse', base], main);
  if (r.status !== 0) {
    console.warn(
      `Local ${base} not updated (it has commits origin lacks, or local edits overlap the incoming change):\n` +
        `${(r.stderr || r.stdout || '').trim()}\nLeft as is; nothing was reset or stashed.`,
    );
  } else {
    log(
      before === after
        ? `Local ${base} is current.`
        : `Local ${base}: ${before?.slice(0, 7)} -> ${after?.slice(0, 7)}.`,
    );
  }
  // The main checkout's node_modules belongs to whatever it has checked out.
  if (checkedOut !== base) return;
  const stamp = existsSync(join(main, STAMP)) ? readFileSync(join(main, STAMP), 'utf8') : null;
  if (stamp !== lockHash(main)) install(main);
}

function localFiles() {
  // Ignored, untracked files; --directory folds ignored folders (node_modules,
  // .worktrees, build output) into one entry ending in /, which is skipped.
  const out =
    tryGit(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], main) ?? '';
  return out.split('\n').filter((f) => {
    if (!f || f.endsWith('/') || SKIP_FILE.test(basename(f))) return false;
    try {
      return statSync(join(main, f)).size <= MAX_COPY_BYTES;
    } catch {
      return false;
    }
  });
}

function create(task, branch = task) {
  if (!task || !/^[a-z0-9][a-z0-9._/-]*$/i.test(task) || task.includes('..'))
    fail('Usage: node scripts/worktree.mjs new <task> [branch]');
  const dir = join(main, '.worktrees', task);
  if (existsSync(dir)) fail(`${dir} already exists. Pick another task name.`);
  if (tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], main))
    fail(`Branch ${branch} already exists. Pass a different branch name.`);
  if (tryGit(['check-ignore', '-q', `.worktrees/${task}`], main) === null)
    fail('.worktrees/ is not gitignored here. Add it to .gitignore first.');

  sync();
  // Cut from origin's tip, which is the local base too when sync fast-forwarded it.
  git(['worktree', 'add', '--quiet', '-b', branch, dir, `origin/${base}`], main);
  const copied = localFiles();
  for (const f of copied) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(main, f), join(dir, f));
  }

  let deps;
  if (!existsSync(join(main, 'package.json'))) deps = 'no package.json';
  else if (isWorkspace(main)) {
    install(dir);
    deps = 'own node_modules (workspace monorepo)';
  } else if (lockHash(dir) !== lockHash(main) || git(['branch', '--show-current'], main) !== base) {
    install(dir);
    deps = `own node_modules (lockfile differs from the main checkout's)`;
  } else deps = `shares ${join(main, 'node_modules')} (same lockfile)`;

  log(
    `\nReady: ${dir}\n  branch ${branch}, from origin/${base}\n  dependencies: ${deps}\n` +
      `  copied from the main checkout: ${copied.length ? copied.join(', ') : 'nothing'}`,
  );
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'new') create(...args);
else if (cmd === 'sync') sync();
else fail('Usage: node scripts/worktree.mjs new <task> [branch] | sync');
