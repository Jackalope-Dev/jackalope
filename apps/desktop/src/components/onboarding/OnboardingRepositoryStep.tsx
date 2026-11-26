import { describeError } from '@jackalope/contracts/errors';
import { Button, InlineNotice, LoadingState } from '@jackalope/ui';
import { ArrowRight, FolderPlus } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { invokeNative } from '../../lib/native/transport';
import { addDetectedProject, openProject, validateProject } from '../../lib/project-setup';
import { useProjectDiscoveryStore } from '../../stores/projectDiscoveryStore';
import type { Project } from '../../stores/projectStore';
import { RepositoryChoices } from '../projects/RepositoryChoices';

/** Whether first-run setup should show the repositories it found instead of the folder picker. */
export function useRepositoryStep(enabled: boolean) {
  const { status, found, dismissed } = useProjectDiscoveryStore(
    useShallow((state) => ({
      status: state.status,
      found: state.candidates.length > 0,
      dismissed: state.dismissed,
    })),
  );
  if (!enabled || dismissed) return null;
  if (status === 'idle' || status === 'scanning') return 'scanning';
  // A failed scan says why, beside the way to choose a folder.
  return found || status === 'failed' ? 'found' : null;
}

/**
 * First-run setup's list of repositories found on this computer. The chosen ones are added
 * as projects with their commands detected; the first continues through setup.
 */
export function OnboardingRepositoryStep({
  busy,
  attempt,
  errorNotice,
  onOpened,
}: {
  busy: boolean;
  attempt: (action: () => Promise<void>) => Promise<void>;
  errorNotice: ReactNode;
  /** Continues setup with the first chosen repository, staged but not yet saved. */
  onOpened: (project: Project) => Promise<void>;
}) {
  const discovery = useProjectDiscoveryStore();
  const [failures, setFailures] = useState<string[]>([]);
  const [pickError, setPickError] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: scan once when setup reaches this step
  useEffect(() => {
    if (discovery.status === 'idle') void discovery.scan();
  }, []);
  const chosen = discovery.candidates
    .map((candidate) => candidate.path)
    .filter((path) => discovery.selected.includes(path));
  const addFolder = async () => {
    setPickError('');
    try {
      const picked = await invokeNative<string | null>('task_pick_project');
      if (!picked) return;
      const info = await validateProject(picked);
      discovery.include({
        path: info.path,
        name: info.name,
        hasCommits: info.repository,
        sessions: 0,
        sources: [],
        recommended: false,
      });
    } catch (cause) {
      setPickError(describeError(cause));
    }
  };
  const add = () =>
    attempt(async () => {
      const [first, ...rest] = chosen;
      if (!first) return;
      const staged = await openProject(first, { provisional: true });
      const failed: string[] = [];
      for (const path of rest) {
        try {
          await addDetectedProject(path);
          discovery.toggle(path, false);
        } catch (cause) {
          failed.push(`${path}: ${describeError(cause)}`);
        }
      }
      setFailures(failed);
      // The ones added stay added; the rest wait here to be retried or unchecked.
      if (failed.length) return;
      discovery.dismiss();
      await onOpened(staged);
    });

  if (discovery.status === 'idle' || discovery.status === 'scanning')
    return (
      <>
        <LoadingState label="Looking for repositories on this computer…" />
        <div className="onboarding-actions">
          <Button variant="ghost" onClick={discovery.dismiss}>
            Choose a folder instead
          </Button>
        </div>
      </>
    );
  return (
    <>
      <p className="onboarding-description">
        From your Claude Code and Codex history, your code folders and recent editor windows. Choose
        the ones to add as projects; you can add more any time.
      </p>
      <RepositoryChoices
        label="Repositories to add as projects"
        candidates={discovery.candidates}
        selected={discovery.selected}
        disabled={busy}
        onToggle={discovery.toggle}
      />
      {discovery.error && <InlineNotice tone="error">{discovery.error}</InlineNotice>}
      {pickError && <InlineNotice tone="error">{pickError}</InlineNotice>}
      {!!failures.length && (
        <InlineNotice tone="warning">
          Some repositories could not be added: {failures.join('; ')}
        </InlineNotice>
      )}
      {errorNotice}
      <div className="onboarding-actions">
        <Button variant="ghost" disabled={busy} onClick={() => void addFolder()}>
          <FolderPlus size={16} />
          Add another folder…
        </Button>
        <Button variant="outline" disabled={busy} onClick={discovery.dismiss}>
          Skip
        </Button>
        <Button disabled={busy || !chosen.length} onClick={() => void add()}>
          {chosen.length > 1 ? `Add ${chosen.length} projects` : 'Add project'}
          <ArrowRight size={16} />
        </Button>
      </div>
    </>
  );
}
