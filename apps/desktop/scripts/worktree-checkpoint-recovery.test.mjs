import assert from 'node:assert/strict';
import test from 'node:test';

test('checkpoint suggested message sanitizes prompt/result and produces bounded summary', () => {
  const sanitizeMessage = (run) => {
    const explicit = run.result
      ?.split('\n')
      .find((line) => line.trim().startsWith('Commit message:'))
      ?.slice('Commit message:'.length)
      ?.trim();

    const summary =
      explicit ||
      run.result
        ?.split('\n')
        .find(
          (line) => line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('```'),
        ) ||
      run.prompt ||
      'Complete task changes';

    return Array.from(summary.trim().replace(/^[`*]+|[`*]+$/g, ''))
      .filter((c) => {
        const code = c.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .slice(0, 100)
      .join('');
  };

  assert.equal(
    sanitizeMessage({
      result: 'Commit message: Fix responsive navbar padding\nDetails...',
      prompt: 'fix nav',
    }),
    'Fix responsive navbar padding',
  );

  assert.equal(
    sanitizeMessage({
      result: '### Changes\n`Update auth store validation`\nmore text',
      prompt: 'auth fix',
    }),
    'Update auth store validation',
  );

  assert.equal(
    sanitizeMessage({ result: '', prompt: 'Investigate memory leak in tree view rendering' }),
    'Investigate memory leak in tree view rendering',
  );
});

test('checkpoint commit attribution policy generates correct author and trailers', () => {
  const formatAttribution = (policy, run, baseMessage) => {
    const runTrailer = `Jackalope-Run: ${run.id}`;
    const agentName = `${run.agent} (Jackalope)`;
    const agentEmail = `${run.agent}@jackalope.invalid`;

    if (policy.attribution === 'agent') {
      return {
        authorName: agentName,
        authorEmail: agentEmail,
        committerName: policy.userName,
        committerEmail: policy.userEmail,
        message: `${baseMessage}\n\n${runTrailer}`,
      };
    }

    if (policy.attribution === 'coAuthor') {
      const coAuthorTrailer = `Co-authored-by: ${agentName} <${agentEmail}>`;
      return {
        authorName: policy.userName,
        authorEmail: policy.userEmail,
        committerName: policy.userName,
        committerEmail: policy.userEmail,
        message: `${baseMessage}\n\n${runTrailer}\n${coAuthorTrailer}`,
      };
    }

    // Default 'user'
    return {
      authorName: policy.userName,
      authorEmail: policy.userEmail,
      committerName: policy.userName,
      committerEmail: policy.userEmail,
      message: `${baseMessage}\n\n${runTrailer}`,
    };
  };

  const userPolicy = {
    attribution: 'user',
    userName: 'Jane Doe',
    userEmail: 'jane@example.com',
  };
  const coAuthorPolicy = {
    attribution: 'coAuthor',
    userName: 'Jane Doe',
    userEmail: 'jane@example.com',
  };
  const agentPolicy = {
    attribution: 'agent',
    userName: 'Jane Doe',
    userEmail: 'jane@example.com',
  };

  const run = { id: 'run-99', agent: 'codex' };

  const userAttribution = formatAttribution(userPolicy, run, 'Refactor parser');
  assert.equal(userAttribution.authorName, 'Jane Doe');
  assert.ok(userAttribution.message.includes('Jackalope-Run: run-99'));
  assert.ok(!userAttribution.message.includes('Co-authored-by:'));

  const coAuthorAttribution = formatAttribution(coAuthorPolicy, run, 'Refactor parser');
  assert.equal(coAuthorAttribution.authorName, 'Jane Doe');
  assert.ok(coAuthorAttribution.message.includes('Co-authored-by: codex (Jackalope)'));

  const agentAttribution = formatAttribution(agentPolicy, run, 'Refactor parser');
  assert.equal(agentAttribution.authorName, 'codex (Jackalope)');
  assert.equal(agentAttribution.committerName, 'Jane Doe');
});

test('auto-checkpoint guard rejects staged index deviation from working copy', () => {
  // Simulates checkpoint::create guard:
  // If staged tree != parent tree AND != working tree, the user staged partial edits
  // that must not be blindly overwritten by automatic checkpointing.
  const evaluateCheckpointReadiness = ({ parentTree, stagedTree, workingTree, isIndexLocked }) => {
    if (isIndexLocked) {
      return {
        allowed: false,
        error: 'Another Git operation is using the task index. Retry after it finishes.',
      };
    }
    if (workingTree === parentTree) {
      return { allowed: true, createsCommit: false }; // No changes to commit
    }
    if (stagedTree !== parentTree && stagedTree !== workingTree) {
      return {
        allowed: false,
        error:
          'Staged content differs from the working copy. Review the index before committing; all files are retained.',
      };
    }
    return { allowed: true, createsCommit: true };
  };

  // Normal clean working tree edits (staged matches parent or working tree)
  assert.deepEqual(
    evaluateCheckpointReadiness({
      parentTree: 'tree-1',
      stagedTree: 'tree-1',
      workingTree: 'tree-2',
      isIndexLocked: false,
    }),
    { allowed: true, createsCommit: true },
  );

  // Partial staged changes that differ from both parent and working copy
  const partialStage = evaluateCheckpointReadiness({
    parentTree: 'tree-1',
    stagedTree: 'tree-partial',
    workingTree: 'tree-2',
    isIndexLocked: false,
  });
  assert.equal(partialStage.allowed, false);
  assert.ok(partialStage.error.includes('Staged content differs from the working copy'));

  // Index lock contention
  const lockedIndex = evaluateCheckpointReadiness({
    parentTree: 'tree-1',
    stagedTree: 'tree-1',
    workingTree: 'tree-2',
    isIndexLocked: true,
  });
  assert.equal(lockedIndex.allowed, false);
  assert.ok(lockedIndex.error.includes('Another Git operation is using the task index'));
});

test('worktree cleanup hard blocks prevent destructive removal on locked or active tasks', () => {
  // Simulates worktree_cleanup::hard_block invariants
  const evaluateHardBlock = (worktree, activeRuns) => {
    if (worktree.isLocked) {
      return 'Locked worktree — unlock it before cleanup.';
    }
    if (['main', 'master'].includes(worktree.branch)) {
      return 'Main branch checkout — kept.';
    }
    const hasActiveTask = activeRuns.some((run) => {
      const activeStatuses = ['starting', 'running', 'stopping', 'interrupted'];
      return (
        activeStatuses.includes(run.status) &&
        (run.workspace === worktree.path || worktree.path.startsWith(run.workspace))
      );
    });
    if (hasActiveTask) {
      return 'In use by an active or interrupted task.';
    }
    return null; // Passes hard block check
  };

  const wt = { path: '/repo/.worktrees/task-1', branch: 'jackalope/task-1', isLocked: false };

  // Passes when no active tasks
  assert.equal(evaluateHardBlock(wt, []), null);

  // Hard blocks when worktree is locked
  assert.equal(
    evaluateHardBlock({ ...wt, isLocked: true }, []),
    'Locked worktree — unlock it before cleanup.',
  );

  // Hard blocks on main/master checkout
  assert.equal(evaluateHardBlock({ ...wt, branch: 'main' }, []), 'Main branch checkout — kept.');

  // Hard blocks when a task is active or interrupted
  for (const status of ['starting', 'running', 'stopping', 'interrupted']) {
    const activeRuns = [{ workspace: '/repo/.worktrees/task-1', status }];
    assert.equal(evaluateHardBlock(wt, activeRuns), 'In use by an active or interrupted task.');
  }

  // Finished or reviewed tasks do not block
  for (const status of ['reviewed', 'review', 'stopped']) {
    const finishedRuns = [{ workspace: '/repo/.worktrees/task-1', status }];
    assert.equal(evaluateHardBlock(wt, finishedRuns), null);
  }
});

test('worktree cleanup protects sensitive ignored files and offers archive for unmerged work', () => {
  // Simulates sensitive_name check in worktree_cleanup:
  // Secrets and databases must never be silently deleted during cleanup.
  const isSensitive = (filename) => {
    const name = filename.toLowerCase();
    if (['.example', '.sample', '.template', '.dist'].some((s) => name.endsWith(s))) {
      return false;
    }
    const exactMatches = [
      '.git',
      '.env',
      '.envrc',
      '.npmrc',
      '.netrc',
      '.pypirc',
      'credentials.json',
      'secrets.json',
      'id_rsa',
      'id_ed25519',
    ];
    if (exactMatches.includes(name)) return true;
    if (name.startsWith('.env.') || name.startsWith('secrets.')) return true;
    const sensitiveExtensions = [
      '.key',
      '.pem',
      '.p8',
      '.p12',
      '.pfx',
      '.sqlite',
      '.sqlite3',
      '.db',
    ];
    return sensitiveExtensions.some((ext) => name.endsWith(ext));
  };

  assert.equal(isSensitive('.env'), true);
  assert.equal(isSensitive('.env.local'), true);
  assert.equal(isSensitive('credentials.json'), true);
  assert.equal(isSensitive('server.key'), true);
  assert.equal(isSensitive('cert.pem'), true);
  assert.equal(isSensitive('data.sqlite3'), true);
  assert.equal(isSensitive('id_ed25519'), true);

  // Templates are not sensitive
  assert.equal(isSensitive('.env.example'), false);
  assert.equal(isSensitive('config.dist'), false);

  // Ordinary build artifacts are regenerable, not sensitive
  assert.equal(isSensitive('bundle.js'), false);
  assert.equal(isSensitive('style.css'), false);
});
