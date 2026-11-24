import { describeError } from '@jackalope/contracts/errors';
import { Button, CopyButton, InlineNotice, Input, Popover, SearchField } from '@jackalope/ui';
import { Check, ChevronDown, GitBranch, Plus } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useKeybindingHandlers, useResolvedKeybindings } from '../../hooks/useKeybindings';
import { navigateWorkspace } from '../../lib/app-events';
import { type BranchList, listBranches, switchBranch } from '../../lib/git-branches';
import { withShortcut } from '../../lib/keybindings';
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
  /** Undefined when another worktree that Jackalope did not start holds the branch. */
  pick?: () => void;
}

/**
 * The project checkout's branches. Picking one switches the checkout with `git switch`;
 * a branch a task worktree holds opens that task instead. New branch names one to
 * create at the current commit.
 */
function BranchPicker({
  project,
  inCheckout,
  input,
  creating,
  setCreating,
  close,
}: {
  project: Project;
  /** Whether the project checkout, not a task worktree, is in focus. */
  inCheckout: boolean;
  input: RefObject<HTMLInputElement | null>;
  /** The new branch name being entered, or null while filtering; Escape leaves it in the popover. */
  creating: string | null;
  setCreating: (name: string | null) => void;
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
    const exact = rows.findIndex((row) => row.branch.toLowerCase() === needle);
    if (exact > 0) rows.unshift(...rows.splice(exact, 1));
  }
  const startCreating = (name: string) => {
    setError('');
    setCreating(name);
    requestAnimationFrame(() => input.current?.focus());
  };
  const from = branches?.current || 'the current commit';

  const buttons = () =>
    [...(list.current?.querySelectorAll('button:not(:disabled)') ?? [])] as HTMLButtonElement[];
  const onInputKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons()[0]?.focus();
    } else if (event.key === 'Enter' && !busy) {
      event.preventDefault();
      const first = rows.find((row) => row.pick);
      if (first) first.pick?.();
      else if (query.trim()) startCreating(query.trim());
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

  if (creating !== null) {
    const name = creating.trim();
    const create = () => {
      if (name && !busy) void change(name, true);
    };
    return (
      <section className="branch-switch" aria-labelledby="branch-create-heading">
        <div className="branch-switch-heading">
          <h3 id="branch-create-heading">New branch</h3>
        </div>
        <Input
          ref={input}
          value={creating}
          onChange={(event) => setCreating(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              create();
            }
          }}
          placeholder="Branch name"
          aria-label="New branch name"
          aria-describedby="branch-create-from"
          disabled={busy}
        />
        <p id="branch-create-from" className="branch-details-note">
          {branches?.changed
            ? `Starts from ${from} and takes your uncommitted changes with it.`
            : `Starts from ${from}.`}
        </p>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <div className="branch-create-actions">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCreating(null)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name} loading={busy} onClick={create}>
            Create and switch
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="branch-switch" aria-labelledby="branch-switch-heading">
      <div className="branch-switch-heading">
        <h3 id="branch-switch-heading">Project branches</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !branches}
          onClick={() => startCreating('')}
        >
          <Plus size={14} aria-hidden="true" />
          New branch
        </Button>
      </div>
      <SearchField
        ref={input}
        value={query}
        onValueChange={setQuery}
        onKeyDown={onInputKey}
        placeholder="Filter branches"
        aria-label="Filter branches"
        aria-controls="branch-switch-list"
        disabled={busy}
      />
      {branches?.changed && !error && (
        <p className="branch-details-note">
          This checkout has uncommitted changes. Commit them before switching, or create a new
          branch to take them with you.
        </p>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {!branches && !error && <p className="branch-details-note">Loading branches…</p>}
      {branches && rows.length === 0 && (
        <div className="branch-switch-empty">
          <p className="branch-details-note">No branches match.</p>
          {query.trim() && (
            <Button variant="secondary" size="sm" onClick={() => startCreating(query.trim())}>
              <Plus size={14} aria-hidden="true" />
              Create {query.trim()}
            </Button>
          )}
        </div>
      )}
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
                <GitBranch size={14} aria-hidden="true" className="branch-switch-icon" />
                <span className="branch-switch-label">{branchLabel(row.branch)}</span>
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
  const [creating, setCreating] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const shortcuts = useResolvedKeybindings();
  useKeybindingHandlers({
    branchMenu: () => {
      if (!project || host) return false;
      setOpen(!open);
      if (open) setCreating(null);
    },
  });
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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCreating(null);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="chrome-branch"
          title={withShortcut(`${project.name} · Branch: ${branch}`, shortcuts.branchMenu)}
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
          onEscapeKeyDown={(event) => {
            if (creating === null) return;
            event.preventDefault();
            setCreating(null);
          }}
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
              creating={creating}
              setCreating={setCreating}
              close={() => {
                setOpen(false);
                setCreating(null);
              }}
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
