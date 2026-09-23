import { Badge, Checkbox, IconButton, RefreshIcon } from '@jackalope/ui';
import { Bot, FileDiff, FolderGit2, GitCommitHorizontal, Settings2, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CommitPolicy, projectGitPolicy } from '../../lib/project-git';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useCommitReviewStore } from '../../stores/commitReviewStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { DiffPreview } from '../tasks/DiffPreview';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import './commit-review.css';

interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
  additions: number | null;
  deletions: number | null;
}
interface WorkingChanges {
  branch: string | null;
  head: string | null;
  files: ChangedFile[];
}

const STATUS = {
  modified: { letter: 'M', label: 'Modified' },
  added: { letter: 'A', label: 'Added' },
  untracked: { letter: 'A', label: 'New file' },
  deleted: { letter: 'D', label: 'Deleted' },
  renamed: { letter: 'R', label: 'Renamed' },
  conflicted: { letter: '!', label: 'Conflict' },
} as const;

const TITLE_LIMIT = 72;

function splitPath(path: string) {
  const index = path.lastIndexOf('/');
  return index < 0
    ? { dir: '', name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

function authorLine(policy: CommitPolicy | null, agents: string[]) {
  if (!policy) return 'Loading commit settings…';
  const you = policy.name ? `${policy.name} <${policy.email}>` : 'your Git identity';
  if (policy.attribution === 'agent')
    return agents.length
      ? `Authored by ${agents.join(', ')}`
      : `Authored by ${you} (no agent worked here)`;
  if (policy.attribution === 'coAuthor' && agents.length)
    return `Authored by ${you}, co-authored by ${agents.join(', ')}`;
  return `Authored by ${you}`;
}

export function CommitReview({ onOpenProject }: { onOpenProject: () => void }) {
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  );
  const loadWorktrees = useProjectStore((state) => state.loadWorktreesForActiveProject);
  const runs = useExecutionStore((state) => state.runs);
  const { checkout: chosen, choose } = useCommitReviewStore();
  const desktop = isTauriEnvironment();
  const projectPath = project?.path ?? '';
  const checkouts = useMemo(() => {
    const worktrees = (project?.worktrees ?? []).slice(1).filter((wt) => !wt.is_bare);
    return [
      {
        path: projectPath,
        label: `Project folder${project?.gitBranch ? ` · ${project.gitBranch}` : ''}`,
      },
      ...worktrees.map((wt) => ({ path: wt.path, label: wt.branch || wt.path })),
    ];
  }, [project, projectPath]);
  const checkout = checkouts.some((item) => item.path === chosen) ? chosen : projectPath;

  const [changes, setChanges] = useState<WorkingChanges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState('');
  const [patch, setPatch] = useState<{ path: string; text: string } | null>(null);
  const [patchError, setPatchError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [policy, setPolicy] = useState<CommitPolicy | null>(null);
  const current = useRef(checkout);
  current.current = checkout;
  const known = useRef(new Set<string>());

  const files = changes?.files ?? [];
  const branch = changes?.branch ?? null;
  const agents = useMemo(() => {
    if (!branch || !project) return [];
    return [
      ...new Set(
        runs
          .filter((run) => run.projectId === project.id && run.branch === branch)
          .map((run) => run.agent),
      ),
    ].sort();
  }, [runs, branch, project]);

  const refresh = useCallback(async () => {
    if (!projectPath || !checkout || !desktop) return;
    const target = checkout;
    setLoading(true);
    setError('');
    try {
      const next = await nativeTask<WorkingChanges>('git_working_changes', {
        repoPath: projectPath,
        worktreePath: target,
      });
      if (current.current !== target) return;
      setChanges(next);
      const paths = new Set(next.files.map((file) => file.path));
      // Keep the user's choices across refreshes; new files start selected.
      const seen = known.current;
      setSelected(
        (previous) => new Set([...paths].filter((path) => previous.has(path) || !seen.has(path))),
      );
      known.current = paths;
      setFocused((previous) => (paths.has(previous) ? previous : (next.files[0]?.path ?? '')));
    } catch (cause) {
      if (current.current === target) setError(String(cause));
    } finally {
      if (current.current === target) setLoading(false);
    }
  }, [projectPath, checkout, desktop]);

  useEffect(() => {
    setChanges(null);
    known.current = new Set();
    setSelected(new Set());
    setFocused('');
    setFeedback('');
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (projectPath && desktop) void loadWorktrees();
  }, [projectPath, desktop, loadWorktrees]);
  useEffect(() => {
    if (!projectPath || !desktop) return;
    projectGitPolicy(projectPath)
      .then(setPolicy)
      .catch((cause) => setError(String(cause)));
  }, [projectPath, desktop]);
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useEffect(() => {
    // `changes` is a trigger: refetch so an edited file shows its latest diff.
    if (!changes || !focused || !projectPath) return setPatch(null);
    let live = true;
    setPatchError('');
    nativeTask<string>('git_working_file_diff', {
      repoPath: projectPath,
      worktreePath: checkout,
      path: focused,
    })
      .then((text) => {
        if (live) setPatch({ path: focused, text });
      })
      .catch((cause) => {
        if (!live) return;
        setPatch(null);
        setPatchError(String(cause));
      });
    return () => {
      live = false;
    };
  }, [focused, projectPath, checkout, changes]);

  const chosenFiles = files.filter((file) => selected.has(file.path));
  const totals = files.reduce(
    (sum, file) => ({ add: sum.add + (file.additions ?? 0), del: sum.del + (file.deletions ?? 0) }),
    { add: 0, del: 0 },
  );
  const allSelected = files.length > 0 && chosenFiles.length === files.length;
  const busy = generating || committing;

  const toggle = (path: string, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });

  const generate = async () => {
    if (busy || !chosenFiles.length) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const message = await nativeTask<{ title: string; body: string }>(
        'git_generate_commit_message',
        {
          repoPath: projectPath,
          worktreePath: checkout,
          paths: chosenFiles.map((file) => file.path),
        },
      );
      setTitle(message.title);
      setBody(message.body);
    } catch (cause) {
      setGenerateError(String(cause));
    } finally {
      setGenerating(false);
    }
  };

  const commit = async () => {
    if (busy || !chosenFiles.length || !title.trim()) return;
    setCommitting(true);
    setError('');
    setFeedback('');
    try {
      const sha = await nativeTask<string>('git_commit_changes', {
        repoPath: projectPath,
        worktreePath: checkout,
        paths: chosenFiles.map((file) => file.path),
        title,
        body,
        agents,
      });
      setFeedback(
        `Committed ${chosenFiles.length} ${chosenFiles.length === 1 ? 'file' : 'files'} as ${sha.slice(0, 7)}.`,
      );
      setTitle('');
      setBody('');
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setCommitting(false);
    }
  };

  const askForReview = () => {
    if (!project) return;
    const key = `helper-commit-review-${Date.now()}`;
    const list = (chosenFiles.length ? chosenFiles : files)
      .map((file) => `- ${file.path} (${STATUS[file.status].label.toLowerCase()})`)
      .join('\n');
    useExecutionStore.getState().draft(key, {
      title: `Review uncommitted work${branch ? ` on ${branch}` : ''}`,
      prompt: [
        `Review the uncommitted changes in ${checkout}${branch ? ` (branch ${branch})` : ''}.`,
        'Read them with `git status` and `git diff HEAD` in that folder. Do not edit, stage or commit anything.',
        'Report correctness bugs, risky changes, missing tests and anything unfinished, most severe first, with file and line references.',
        '',
        'Files:',
        list,
      ].join('\n'),
      projectId: project.id,
      isolated: false,
      agent: '',
    });
    window.dispatchEvent(new CustomEvent('jackalope:helper-draft', { detail: key }));
  };

  if (!project)
    return (
      <WorkspacePage>
        <WorkspaceHeading title="Changes" />
        <EmptyState
          icon={FolderGit2}
          title="Choose a project"
          description="Open a repository to review and commit its changes."
          action={<Button onClick={onOpenProject}>Open project</Button>}
        />
      </WorkspacePage>
    );

  const focusedFile = files.find((file) => file.path === focused);
  return (
    <WorkspacePage className="commit-review-page">
      <WorkspaceHeading
        title="Changes"
        description="Review uncommitted work, choose what to include, and commit."
        action={
          <div className="workspace-actions">
            <Select value={checkout} onValueChange={choose} disabled={busy} aria-label="Checkout">
              {checkouts.map((item) => (
                <SelectItem key={item.path} value={item.path}>
                  {item.label}
                </SelectItem>
              ))}
            </Select>
            <IconButton
              variant="ghost"
              label="Refresh changes"
              title="Refresh changes"
              disabled={loading || busy || !desktop}
              onClick={() => void refresh()}
            >
              <RefreshIcon size={20} />
            </IconButton>
          </div>
        }
      />
      {error && (
        <InlineNotice tone="error" className="commit-review-notice">
          {error}
        </InlineNotice>
      )}
      <div role="status">
        {feedback && (
          <InlineNotice tone="success" className="commit-review-notice">
            {feedback}
          </InlineNotice>
        )}
      </div>
      {!changes && loading ? (
        <LoadingState label="Reading changes…" />
      ) : !files.length ? (
        <EmptyState
          icon={GitCommitHorizontal}
          title="Nothing to commit"
          description={`${branch ? `${branch} is` : 'This checkout is'} clean. Changes made here or by agents will show up automatically.`}
        />
      ) : (
        <div className="commit-review">
          <aside className="commit-review-side">
            <section className="commit-files" aria-label="Changed files">
              <header>
                <label>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={chosenFiles.length > 0 && !allSelected}
                    disabled={busy}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked ? new Set(files.map((file) => file.path)) : new Set(),
                      )
                    }
                  />
                  <span>
                    {chosenFiles.length} of {files.length} selected
                  </span>
                </label>
                <span className="commit-stat">
                  <ins>+{totals.add}</ins> <del>−{totals.del}</del>
                </span>
              </header>
              <ul>
                {files.map((file) => {
                  const { dir, name } = splitPath(file.path);
                  const status = STATUS[file.status];
                  return (
                    <li key={file.path} data-focused={file.path === focused || undefined}>
                      <Checkbox
                        aria-label={`Include ${file.path}`}
                        checked={selected.has(file.path)}
                        disabled={busy}
                        onChange={(event) => toggle(file.path, event.target.checked)}
                      />
                      <button
                        type="button"
                        onClick={() => setFocused(file.path)}
                        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                      >
                        <span
                          className="commit-status"
                          data-status={file.status}
                          title={status.label}
                        >
                          {status.letter}
                        </span>
                        <span className="commit-file-name">
                          <strong>{name}</strong>
                          {dir && <small>{dir}</small>}
                        </span>
                        {file.additions !== null && (
                          <span className="commit-stat">
                            <ins>+{file.additions}</ins> <del>−{file.deletions ?? 0}</del>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
            <form
              className="commit-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void commit();
              }}
            >
              <div className="commit-compose-heading">
                <h2>Commit message</h2>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy || !chosenFiles.length}
                  loading={generating}
                  loadingLabel="Writing…"
                  onClick={() => void generate()}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  Generate
                </Button>
              </div>
              {generateError && (
                <InlineNotice tone="error" className="commit-generate-error">
                  <span>{generateError}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => navigateWorkspace('agents')}
                  >
                    Set up agents
                  </Button>
                </InlineNotice>
              )}
              <label className="commit-field">
                <span className="sr-only">Title</span>
                <Input
                  value={title}
                  maxLength={200}
                  placeholder="Summarize the change"
                  disabled={committing}
                  onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
                />
                <small data-over={title.length > TITLE_LIMIT || undefined}>
                  {title.length}/{TITLE_LIMIT}
                </small>
              </label>
              <label className="commit-field">
                <span className="sr-only">Description</span>
                <Textarea
                  value={body}
                  rows={5}
                  placeholder="Description (optional)"
                  disabled={committing}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
              <p className="commit-author">
                <span>{authorLine(policy, agents)}</span>
                <button
                  type="button"
                  className="commit-author-link"
                  onClick={() => navigateWorkspace('project-settings')}
                >
                  <Settings2 size={13} aria-hidden="true" />
                  Change
                </button>
              </p>
              <Button
                type="submit"
                disabled={busy || !chosenFiles.length || !title.trim() || !desktop}
                loading={committing}
                loadingLabel="Committing…"
              >
                <GitCommitHorizontal size={18} aria-hidden="true" />
                Commit {chosenFiles.length} {chosenFiles.length === 1 ? 'file' : 'files'}
                {branch ? ` to ${branch}` : ''}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={askForReview}>
                <Bot size={18} aria-hidden="true" />
                Ask an agent to review
              </Button>
            </form>
          </aside>
          <section className="commit-diff" aria-label="Diff">
            {focusedFile && (
              <header>
                <FileDiff size={16} aria-hidden="true" />
                <span className="commit-diff-path">
                  {focusedFile.oldPath ? `${focusedFile.oldPath} → ` : ''}
                  {focusedFile.path}
                </span>
                <Badge variant={focusedFile.status === 'conflicted' ? 'danger' : 'outline'}>
                  {STATUS[focusedFile.status].label}
                </Badge>
              </header>
            )}
            {patchError ? (
              <InlineNotice>{patchError}</InlineNotice>
            ) : patch?.path === focused ? (
              patch.text.trim() ? (
                <DiffPreview patch={patch.text} file={focused} />
              ) : (
                <p className="task-muted">No text changes (mode or binary change).</p>
              )
            ) : (
              <LoadingState label="Opening diff…" compact />
            )}
          </section>
        </div>
      )}
    </WorkspacePage>
  );
}
