import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  InlineNotice,
  LoadingState,
  useDialogFocus,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useAppEvent } from '../../lib/app-events';
import { type DiscoveryScan, recommendedPaths, scanForProjects } from '../../lib/project-discovery';
import { addDetectedProject } from '../../lib/project-setup';
import { useProjectStore } from '../../stores/projectStore';
import { RepositoryChoices } from './RepositoryChoices';

function FindProjectsDialog({ onClose }: { onClose: () => void }) {
  const dialogFocus = useDialogFocus();
  const [scan, setScan] = useState<DiscoveryScan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => {
    let canceled = false;
    void scanForProjects()
      .then((next) => {
        if (canceled) return;
        setScan(next);
        setSelected([...recommendedPaths(next.candidates)]);
      })
      .catch((cause) => !canceled && setError(describeError(cause)));
    return () => {
      canceled = true;
    };
  }, []);
  const candidates = (scan?.candidates ?? []).filter((item) => !added.includes(item.path));
  const chosen = candidates.filter((item) => selected.includes(item.path));
  const add = async () => {
    setBusy(true);
    setError('');
    const active = useProjectStore.getState().activeProjectId;
    const failed: string[] = [];
    for (const candidate of chosen) {
      try {
        await addDetectedProject(candidate.path);
        setAdded((current) => [...current, candidate.path]);
      } catch (cause) {
        failed.push(`${candidate.name}: ${describeError(cause)}`);
      }
    }
    // Adding projects here should not move the person away from the one they had open.
    if (active) useProjectStore.getState().selectProject(active);
    setBusy(false);
    if (failed.length) setError(`Some repositories could not be added: ${failed.join('; ')}`);
    else onClose();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent {...dialogFocus} contained className="find-projects">
        <DialogCloseButton disabled={busy} />
        <DialogHeader
          title="Find projects on this computer"
          description="Repositories from your Claude Code and Codex history, your code folders and recent editor windows that are not projects yet."
        />
        <div className="find-projects-body">
          {!scan && !error && <LoadingState label="Looking for repositories…" />}
          {scan && !candidates.length && (
            <p className="task-muted">
              Every repository Jackalope found is already a project. Use Add project in the sidebar
              for another folder.
            </p>
          )}
          {!!candidates.length && (
            <RepositoryChoices
              label="Repositories to add as projects"
              candidates={candidates}
              selected={selected}
              disabled={busy}
              onToggle={(path, on) =>
                setSelected((current) =>
                  on ? [...current, path] : current.filter((item) => item !== path),
                )
              }
            />
          )}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
        </div>
        <DialogFooter className="find-projects-footer">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={busy || !chosen.length}
            loading={busy}
            loadingLabel="Adding…"
            onClick={() => void add()}
          >
            {chosen.length > 1 ? `Add ${chosen.length} projects` : 'Add project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

/** Holds the dialog command search opens to add repositories found on this computer. */
export function FindProjectsHost() {
  const [open, setOpen] = useState(false);
  useAppEvent('open-project-discovery', () => setOpen(true));
  return open ? <FindProjectsDialog onClose={() => setOpen(false)} /> : null;
}
