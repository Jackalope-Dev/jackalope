import { describeError } from '@jackalope/contracts/errors';
import { Button, CopyButton, InlineNotice, Popover, SearchField } from '@jackalope/ui';
import { Check, ChevronDown, GitBranch, Plus } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { navigateWorkspace } from '../../lib/app-events';
import { type BranchList, listBranches, switchBranch } from '../../lib/git-branches';
import { sessionWork } from '../../lib/live-session';
import { managedTaskWork } from '../../lib/managed-task';
import { openWork, selectWork, useWorkspaceWork } from '../../lib/work-selection';
import { openChanges } from '../../stores/commitReviewStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { type Project, useActiveProject, useProjectStore } from '../../stores/projectStore';

/**
 * The project, remote host and the work in focus: the selected task, plan or
 * conversation. The branch control and the changes count both follow it.
 */
export function useFocusedWork() {
  const host = useHostContextStore((state) => state.host);
  const runs = useExecutionStore((state) => state.runs);
  const selectedId = useExecutionStore((state) => state.selectedId);
  const {
    sessions,
    selectedId: selectedSession,
    runs: sessionRuns,
  } = useLiveSessionStore(
    useShallow((s) => ({ sessions: s.sessions, selectedId: s.selectedId, runs: s.runs })),
  );
  const { queue, selectedId: selectedManaged } = useManagedTaskStore(
    useShallow((s) => ({ queue: s.queue, selectedId: s.selectedId })),
  );
  const project = useActiveProject();
  const session = sessions.find(
    (item) => item.id === selectedSession && item.request.projectId === project?.id,
  );
  const managed = queue.managedTasks?.find(
    (item) => item.id === selectedManaged && item.request.projectId === project?.id,
  );
  const run =
    runs.find((item) => item.id === selectedId && item.projectId === project?.id) ??
    (managed ? managedTaskWork(managed, queue, runs).combined : undefined) ??
    (session ? sessionWork(session, sessionRuns).latest : undefined);
  /** Where that work's files are: its worktree, or the project folder. */
  const checkout = (run?.workspace || '').trim() || project?.path || '';
  return { host, project, run, managed, checkout };
}

/** Older task branches end in a generated id; its first eight characters still tell them apart. */
function branchLabel(branch: string) {
  return branch.replace(/(^|\/)([0-9a-f]{8})(?:-[0-9a-f]{1,4}){2,4}[0-9a-f-]*$/i, '$1$2');
}
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');

interface BranchRow {
  key: string;
  branch: string;
  /** Beneath the branch: the task using it, or why it cannot be picked. */
  detail?: string;
  current?: boolean;
  create?: boolean;
  /** Undefined when another worktree that Jackalope did not start holds the branch. */
  pick?: () => void;
}

/**
 * The project checkout's branches. Picking one switches the checkout with `git switch`;
 * a branch a task worktree holds opens that task instead, and typing a new name offers
 * to create it at the current commit.
 */
function BranchPicker({
  project,
  inCheckout,
  input,
  close,
}: {
  project: Project;
  /** Whether the project checkout, not a task worktree, is in focus. */
  inCheckout: boolean;
  input: RefObject<HTMLInputElement | null>;
  close: () => void;
}) {
  const work = useWorkspaceWork();
  const list = useRef<HTMLUListElement>(null);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    listBranches(project.path).then(
      (next) => current && setBranches(next),
      (reason) => current && setError(describeError(reason)),
    );
    return () => {
      current = false;
    };
  }, [project.path]);

  const focusCheckout = () => {
    if (!inCheckout) {
      selectWork();
      navigateWorkspace('kanban');
    }
  };
  const change = async (branch: string, create: boolean) => {
    setBusy(true);
    setError('');
    try {
      const now = await switchBranch(project.path, branch, create);
      const store = useProjectStore.getState();
      store.updateProject(project.id, { gitBranch: now });
      void store.loadWorktreesForActiveProject();
      focusCheckout();
      close();
    } catch (reason) {
      setError(describeError(reason));
      setBusy(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const rows: BranchRow[] = [];
  if (branches) {
    for (const branch of branches.local) {
      if (needle && !branch.name.toLowerCase().includes(needle)) continue;
      const holder = branch.worktree;
      const task = holder
        ? work.find((item) => {
            const path = item.run?.workspace?.trim();
            return (
              !item.managed && item.run?.projectId === project.id && path && samePath(path, holder)
            );
          })
        : undefined;
      rows.push({
        key: `local:${branch.name}`,
        branch: branch.name,
        current: branch.name === branches.current,
        detail: task ? task.title : holder ? `Checked out in ${holder}` : undefined,
        pick:
          branch.name === branches.current
            ? () => {
                focusCheckout();
                close();
              }
            : task
              ? () => {
                  openWork(task);
                  navigateWorkspace('kanban');
                  close();
                }
              : holder
                ? undefined
                : () => change(branch.name, false),
      });
    }
    for (const name of branches.remote) {
      if (needle && !name.toLowerCase().includes(needle)) continue;
      rows.push({ key: `remote:${name}`, branch: name, pick: () => change(name, false) });
    }
    const typed = query.trim();
    const exact = rows.findIndex((row) => row.branch.toLowerCase() === needle);
    if (exact > 0) rows.unshift(...rows.splice(exact, 1));
    else if (typed && exact < 0) {
      rows.unshift({
        key: 'create',
        branch: typed,
        create: true,
        detail: branches.changed
          ? `From ${branches.current || 'the current commit'}, with your uncommitted changes`
          : `From ${branches.current || 'the current commit'}`,
        pick: () => change(typed, true),
      });
    }
  }

  const buttons = () =>
    [...(list.current?.querySelectorAll('button:not(:disabled)') ?? [])] as HTMLButtonElement[];
  const onInputKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons()[0]?.focus();
    } else if (event.key === 'Enter' && !busy) {
      event.preventDefault();
      rows.find((row) => row.pick)?.pick?.();
    }
  };
  const onListKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = at + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) input.current?.focus();
    else all[Math.min(next, all.length - 1)]?.focus();
  };

  return (
    <section className="branch-switch" aria-labelledby="branch-switch-heading">
      <h3 id="branch-switch-heading">Project branches</h3>
      <SearchField
        ref={input}
        value={query}
        onValueChange={setQuery}
        onKeyDown={onInputKey}
        placeholder="Filter or create a branch"
        aria-label="Filter or create a branch"
        aria-controls="branch-switch-list"
        disabled={busy}
      />
      {branches?.changed && !error && (
        <p className="branch-details-note">
          This checkout has uncommitted changes. Commit them before switching, or create a branch to
          take them with you.
        </p>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {!branches && !error && <p className="branch-details-note">Loading branches…</p>}
      {branches && rows.length === 0 && <p className="branch-details-note">No branches match.</p>}
      {rows.length > 0 && (
        <ul id="branch-switch-list" ref={list} onKeyDown={onListKey}>
          {rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className="branch-switch-item"
                aria-current={row.current || undefined}
                disabled={busy || !row.pick}
                title={row.branch}
                onClick={row.pick}
              >
                {row.create ? (
                  <Plus size={14} aria-hidden="true" className="branch-switch-icon" />
                ) : (
                  <GitBranch size={14} aria-hidden="true" className="branch-switch-icon" />
                )}
                <span className="branch-switch-label">
                  {row.create ? `Create ${row.branch}` : branchLabel(row.branch)}
                </span>
                {row.detail && <span className="branch-switch-name">{row.detail}</span>}
                {row.current && (
                  <Check size={14} aria-label="Checked out" className="branch-switch-check" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The branch in focus, in the status bar; the page header names the scope, so the trigger names the project only in its label. */
export function BranchIndicator() {
  const { host, project, run, managed, checkout } = useFocusedWork();
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  if (!project || host) return null;
  const branch = run
    ? run.branch ||
      (!run.workspace ? 'Preparing workspace' : project.plainFolder ? 'No Git' : 'Branch unknown')
    : managed
      ? 'Plan workspaces'
      : project.plainFolder
        ? 'No Git'
        : project.gitBranch || 'Branch unknown';
  const copyableBranch = run ? run.branch : !managed ? project.gitBranch : '';
  const location = run ? run.workspace : project.path;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="chrome-branch"
          title={`${project.name} · Branch: ${branch}`}
          aria-label={`${project.name}, branch ${branch}`}
        >
          <GitBranch size={14} aria-hidden="true" />
          <span className="chrome-branch-name">{branchLabel(branch)}</span>
          <ChevronDown size={12} aria-hidden="true" className="chrome-branch-chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="workspace-menu statusbar-details"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            if (!search.current) return;
            event.preventDefault();
            search.current.focus();
          }}
        >
          <h2 className="branch-details-title">
            {run ? 'Task workspace' : managed ? 'Plan workspaces' : 'Project checkout'}
          </h2>
          {managed && !run ? (
            <p className="branch-details-note">
              Assignments use separate workspaces. Select an assignment to inspect its branch.
            </p>
          ) : (
            <dl className="branch-facts">
              <div>
                <dt>Branch</dt>
                <dd>{branch}</dd>
                {copyableBranch && (
                  <CopyButton
                    size="sm"
                    text={copyableBranch}
                    label="Copy"
                    aria-label="Copy branch"
                  />
                )}
              </div>
              <div>
                <dt>Path</dt>
                <dd>{location || 'Workspace is being prepared.'}</dd>
                {location && (
                  <CopyButton size="sm" text={location} label="Copy" aria-label="Copy path" />
                )}
              </div>
            </dl>
          )}
          {!project.plainFolder && (
            <BranchPicker
              project={project}
              inCheckout={!managed && samePath(checkout, project.path)}
              input={search}
              close={() => setOpen(false)}
            />
          )}
          <div className="branch-actions">
            {!managed && (
              <Popover.Close asChild>
                <Button variant="secondary" onClick={() => openChanges(checkout)}>
                  Review changes
                </Button>
              </Popover.Close>
            )}
            <Popover.Close asChild>
              <Button variant="outline" onClick={() => navigateWorkspace('worktrees')}>
                Manage worktrees
              </Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
