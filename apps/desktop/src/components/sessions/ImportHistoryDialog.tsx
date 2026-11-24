import {
  Badge,
  Button,
  Checkbox,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Disclosure,
  DisclosureSummary,
  InlineNotice,
  LoadingState,
  Select,
  SelectItem,
  useDialogFocus,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAction } from '../../hooks/useAction';
import { useAppEvent } from '../../lib/app-events';
import {
  activeIn,
  cancelSessionImport,
  IMPORT_PERIODS,
  type ImportCandidate,
  type ImportGroup,
  type ImportPeriod,
  type ImportProgress,
  type ImportScan,
  importable,
  importMilestone,
  initialSelection,
  scanSessionsToImport,
  startSessionImport,
  worthOffering,
} from '../../lib/imported-conversations';
import { isTauriEnvironment } from '../../lib/native/env';
import { openProject } from '../../lib/project-setup';
import { useImportedConversationStore } from '../../stores/importedConversationStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { projectMirrorSaved, useProjectStore } from '../../stores/projectStore';
import { ProviderMark } from '../agents/ProviderMark';
import { ActionError } from '../ui/ActionError';
import { when } from './ProviderTranscript';
import './history-import.css';

const STATUS: Record<ImportCandidate['status'], string | null> = {
  new: null,
  imported: 'Imported',
  changed: 'Changed since import',
  continued: 'Continued in Jackalope',
};

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function count(value: number, one: string, many: string) {
  return `${value.toLocaleString()} ${value === 1 ? one : many}`;
}

function summary(progress: ImportProgress) {
  const parts = [
    progress.imported && `imported ${count(progress.imported, 'conversation', 'conversations')}`,
    progress.updated && `updated ${progress.updated.toLocaleString()}`,
    progress.unchanged && `${progress.unchanged.toLocaleString()} already up to date`,
  ].filter(Boolean);
  const text = parts.length ? parts.join(', ') : 'nothing new to import';
  return `${progress.canceled ? 'Canceled after' : 'Finished:'} ${text}.`;
}

/**
 * Finds the person's Claude Code and Codex conversations on this computer and imports the
 * ones they choose into Jackalope, grouped by the project they ran in.
 */
function ImportHistoryDialog({
  offer = false,
  initialScan,
  onClose,
}: {
  /** Shown once after setup: the copy introduces the import and closing it skips it. */
  offer?: boolean;
  /** A scan already made, so the dialog opens on its result. */
  initialScan?: ImportScan;
  onClose: () => void;
}) {
  const dialogFocus = useDialogFocus();
  const projects = useProjectStore((state) => state.projects);
  const { progress, refreshImported } = useImportedConversationStore(
    useShallow((state) => ({ progress: state.progress, refreshImported: state.refresh })),
  );
  const [scan, setScan] = useState<ImportScan | null>(initialScan ?? null);
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialScan ? initialSelection(initialScan.groups) : new Set(),
  );
  const [period, setPeriod] = useState<ImportPeriod>('all');
  const scanning = useAction();
  const action = useAction();
  const [adding, setAdding] = useState<string | null>(null);
  const running = !!progress?.running;
  const [started, setStarted] = useState(false);

  const cancel = useAction();
  const rescan = (preselect: boolean) =>
    scanning.run(async () => {
      const next = await scanSessionsToImport();
      setScan(next);
      if (preselect) setSelected(initialSelection(next.groups));
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: scan once when the dialog opens
  useEffect(() => {
    if (!initialScan) void rescan(true);
    void refreshImported();
  }, []);
  // A finished import changes what each session's status is.
  const wasRunning = useRef(running);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rescan when an import ends
  useEffect(() => {
    if (running) setStarted(true);
    if (wasRunning.current && !running) {
      setSelected(new Set());
      void rescan(false);
    }
    wasRunning.current = running;
  }, [running]);

  // Announced at the start and each quarter; the visible line updates with every conversation.
  const milestone = running && progress ? importMilestone(progress) : -1;
  const [announcement, setAnnouncement] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: announce only when the milestone changes
  useEffect(() => {
    if (!progress || milestone < 0) return;
    setAnnouncement(
      milestone === 0
        ? `Importing ${count(progress.total, 'conversation', 'conversations')}.`
        : `Imported ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}.`,
    );
  }, [milestone]);
  const groups = useMemo(() => activeIn(scan?.groups ?? [], period), [scan, period]);
  const present = groups.filter((group) => group.exists);
  const gone = groups.filter((group) => !group.exists);
  const chosen = present.flatMap((group) =>
    group.sessions.filter((session) => importable(group, session) && selected.has(session.key)),
  );
  const total = groups.reduce((sum, group) => sum + group.sessions.length, 0);

  const toggle = (keys: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const addProject = (group: ImportGroup) =>
    action.run(async () => {
      setAdding(group.path);
      try {
        const active = useProjectStore.getState().activeProjectId;
        await openProject(group.path);
        // Adding a project here should not move the person away from the one they had open.
        if (active) useProjectStore.getState().selectProject(active);
        await projectMirrorSaved();
        const keys = group.sessions.map((session) => session.key);
        await rescan(false);
        toggle(keys, true);
      } finally {
        setAdding(null);
      }
    });
  const begin = () =>
    action.run(async () => {
      await startSessionImport(chosen.map((session) => session.key));
      setStarted(true);
      await refreshImported();
      // A short import can finish before the store ever sees it running, so the effect
      // that rescans when one ends would not run.
      if (!useImportedConversationStore.getState().progress?.running) {
        setSelected(new Set());
        await rescan(false);
      }
    });

  const projectName = (group: ImportGroup) =>
    projects.find((project) => project.id === group.projectId)?.name ?? folderName(group.path);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent {...dialogFocus} contained className="history-import">
        <DialogCloseButton label={offer ? 'Not now' : 'Close'} />
        <DialogHeader
          title={
            offer ? 'Bring your Claude Code and Codex history' : 'Import Claude and Codex history'
          }
          description={
            offer
              ? 'Jackalope found conversations you had with these CLIs on this computer. Import them to keep them with your projects here, and continue them where they ran.'
              : 'Copies conversations from Claude Code and Codex on this computer into Jackalope. Their own files are only read, and nothing leaves this computer.'
          }
        />
        <div className="history-import-body">
          <div className="history-import-tools">
            <div className="history-import-period">
              <span id="history-import-period">Last active</span>
              <Select
                aria-labelledby="history-import-period"
                value={period}
                onValueChange={(value) => setPeriod(value as ImportPeriod)}
              >
                {Object.entries(IMPORT_PERIODS).map(([value, item]) => (
                  <SelectItem key={value} value={value}>
                    {item.label}
                  </SelectItem>
                ))}
              </Select>
            </div>
            {scan && (
              <span className="history-import-count" role="status">
                {count(total, 'conversation', 'conversations')} found
              </span>
            )}
          </div>
          <ActionError error={scanning.error || scan?.error || action.error || cancel.error} />
          {!scan && scanning.busy && (
            <LoadingState label="Reading Claude Code and Codex history…" />
          )}
          {scan && !groups.length && (
            <p className="history-import-empty">
              {scan.groups.length
                ? 'No conversations were active in this period.'
                : 'No Claude Code or Codex conversations were found on this computer.'}
            </p>
          )}
          {!!groups.length && (
            <div className="history-import-groups">
              {present.map((group) => {
                const choosable = group.sessions.filter((session) => importable(group, session));
                const picked = choosable.filter((session) => selected.has(session.key)).length;
                const name = projectName(group);
                return (
                  <section key={group.path} className="history-import-group" aria-label={name}>
                    <header>
                      {group.projectId ? (
                        <Checkbox
                          aria-label={`Select all conversations in ${name}`}
                          checked={!!choosable.length && picked === choosable.length}
                          indeterminate={picked > 0 && picked < choosable.length}
                          disabled={!choosable.length || running}
                          onChange={(event) =>
                            toggle(
                              choosable.map((session) => session.key),
                              event.target.checked,
                            )
                          }
                        />
                      ) : (
                        <span className="history-import-spacer" aria-hidden="true" />
                      )}
                      <div className="history-import-group-name">
                        <strong>{name}</strong>
                        <span title={group.path}>{group.path}</span>
                      </div>
                      {group.projectId ? (
                        <Badge>Project</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={running || (!!adding && adding !== group.path)}
                          loading={adding === group.path}
                          loadingLabel="Adding…"
                          onClick={() => void addProject(group)}
                        >
                          Add project
                        </Button>
                      )}
                    </header>
                    {!group.projectId && (
                      <p className="history-import-hint">
                        Add this {group.repository ? 'repository' : 'folder'} as a project to import
                        its conversations.
                      </p>
                    )}
                    <ul>
                      {group.sessions.map((session) => {
                        const status = STATUS[session.status];
                        const last = when(session.lastAt);
                        const can = importable(group, session);
                        return (
                          <li key={session.key}>
                            <label data-disabled={!can || undefined}>
                              <Checkbox
                                checked={can && selected.has(session.key)}
                                disabled={!can || running}
                                onChange={(event) => toggle([session.key], event.target.checked)}
                              />
                              <ProviderMark provider={session.agent} size={14} />
                              <span className="history-import-title">
                                {session.title}
                                <span className="sr-only">, {session.agentName}</span>
                              </span>
                              <span className="history-import-meta">
                                {last && (
                                  <time dateTime={session.lastAt} title={last.toLocaleString()}>
                                    {last.toLocaleDateString(undefined, { dateStyle: 'medium' })}
                                  </time>
                                )}
                                <span>{count(session.messages, 'message', 'messages')}</span>
                              </span>
                              {status && (
                                <Badge
                                  variant={session.status === 'changed' ? 'warning' : 'default'}
                                  appearance="plain"
                                >
                                  {status}
                                </Badge>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              {!!gone.length && (
                <p className="history-import-hint">
                  {count(
                    gone.reduce((sum, group) => sum + group.sessions.length, 0),
                    'conversation',
                    'conversations',
                  )}{' '}
                  ran in folders that no longer exist. Jackalope keeps conversations with a project,
                  so these stay in their CLI.
                </p>
              )}
            </div>
          )}
          {progress && (running || started) && (
            <div className="history-import-progress">
              {running ? (
                <>
                  <p className="sr-only" role="status">
                    {announcement}
                  </p>
                  <p>
                    Importing {Math.min(progress.done + 1, progress.total).toLocaleString()} of{' '}
                    {progress.total.toLocaleString()}
                    {progress.current ? ` · ${progress.current}` : ''}
                  </p>
                  <progress
                    aria-label="Import progress"
                    max={Math.max(progress.total, 1)}
                    value={progress.done}
                  />
                </>
              ) : (
                <InlineNotice tone={progress.error ? 'error' : 'success'}>
                  {progress.error ?? summary(progress)}
                </InlineNotice>
              )}
              {!running && !!progress.problems.length && (
                <Disclosure>
                  <DisclosureSummary>
                    {count(progress.problems.length, 'conversation was', 'conversations were')} not
                    imported
                  </DisclosureSummary>
                  <ul className="history-import-problems">
                    {progress.problems.map((problem) => (
                      <li key={problem.key}>
                        <strong>{problem.title}</strong>
                        <span>{problem.reason}</span>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="history-import-footer">
          {running ? (
            <Button
              variant="outline"
              loading={cancel.busy}
              loadingLabel="Canceling…"
              onClick={() => void cancel.run(cancelSessionImport)}
            >
              Cancel import
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {offer && !started ? 'Not now' : 'Close'}
            </Button>
          )}
          <Button
            disabled={running || !chosen.length || scanning.busy}
            loading={action.busy && !adding}
            loadingLabel="Starting…"
            onClick={() => void begin()}
          >
            {chosen.length
              ? `Import ${count(chosen.length, 'conversation', 'conversations')}`
              : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

/**
 * Holds the import dialog for the window: opened from Settings and command search, and
 * offered once after setup when this computer has Claude Code or Codex conversations.
 */
export function HistoryImportHost({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState<{ offer: boolean; scan?: ImportScan } | null>(null);
  const due = useOnboardingStore((state) => state.historyOffer === 'due');
  useAppEvent('open-history-import', () => setOpen({ offer: false }));
  useEffect(() => {
    if (!ready || !due || !isTauriEnvironment()) return;
    let canceled = false;
    // A failed scan leaves the offer for the next launch.
    void scanSessionsToImport()
      .then((scan) => {
        if (canceled) return;
        useOnboardingStore.getState().settleHistoryOffer();
        if (worthOffering(scan)) setOpen((current) => current ?? { offer: true, scan });
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [ready, due]);
  if (!open) return null;
  return (
    <ImportHistoryDialog offer={open.offer} initialScan={open.scan} onClose={() => setOpen(null)} />
  );
}
