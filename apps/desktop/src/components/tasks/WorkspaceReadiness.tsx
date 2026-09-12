import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export interface Readiness {
  head: string;
  branch: string;
  changes: string;
  recentChanges: string;
  prepareCommand: string | null;
  verifyCommand: string | null;
  previewCommand: string | null;
  dependenciesMissing: boolean;
  missingConfiguration: string[];
  notes: string[];
}

export function WorkspaceReadiness({
  project,
  path = project.path,
  expanded = false,
  mode = 'inspect',
}: {
  project: Project;
  path?: string;
  expanded?: boolean;
  mode?: 'inspect' | 'setup';
}) {
  const [result, setResult] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const inspect = async () => {
    if (!isTauriEnvironment()) return;
    setBusy(true);
    setError('');
    try {
      setResult(await nativeTask<Readiness>('project_readiness', { path }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (mode !== 'setup' && !expanded) return;
    let alive = true;
    if (!isTauriEnvironment()) return undefined;
    setBusy(true);
    setError('');
    void nativeTask<Readiness>('project_readiness', { path })
      .then((value) => {
        if (alive) setResult(value);
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [mode, expanded, path]);
  const savedCheck = project.preferences?.verifyCommand;
  const savedPrepare = project.preferences?.prepareCommand;
  const savedVerify = project.preferences?.verifyCommand;
  const savedPreview = project.preferences?.previewCommand;
  if (mode === 'setup') {
    return (
      <div className="space-y-3">
        <p className="task-muted">
          {savedCheck
            ? `After tasks finish, we will run ${savedCheck}.`
            : 'Choose how Jackalope should check finished work. You can change this later in Project settings.'}
        </p>
        {busy && (
          <p role="status" className="task-muted">
            Looking for a test command…
          </p>
        )}
        {result?.verifyCommand && !savedCheck && (
          <>
            <p>
              Suggested check: <code>{result.verifyCommand}</code>
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                useProjectStore.getState().updateProjectPreferences(project.id, {
                  verifyCommand: result.verifyCommand ?? undefined,
                  autoVerify: true,
                });
                setSaved('This check will run after future tasks finish.');
              }}
            >
              Use this check after tasks finish
            </Button>
          </>
        )}
        {saved && <p role="status">{saved}</p>}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>
    );
  }
  return (
    <Disclosure className="my-4" open={expanded || undefined}>
      <DisclosureSummary className="min-h-11 py-3">Workspace readiness</DisclosureSummary>
      <div className="space-y-3">
        <p className="task-muted">
          Inspect setup, local changes and configuration names. Suggested commands remain editable
          in project settings.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void inspect()}
          loading={busy}
          loadingLabel="Inspecting…"
        >
          {result ? 'Refresh workspace setup' : 'Inspect workspace setup'}
        </Button>
        {result && (
          <>
            <p>
              Branch: {result.branch || 'Detached HEAD'} · {result.head.slice(0, 8)}
            </p>
            {result.dependenciesMissing && (
              <InlineNotice>
                This workspace has no node_modules folder. Dependencies may need preparing before
                work can run.
              </InlineNotice>
            )}
            {!!result.missingConfiguration.length && (
              <InlineNotice>
                Configuration names missing from local environment files and the app environment:{' '}
                {result.missingConfiguration.join(', ')}. Configure values in your usual local
                tools.
              </InlineNotice>
            )}
            {savedPrepare ? (
              <p>
                Preparation: <code>{savedPrepare}</code>
              </p>
            ) : result.prepareCommand ? (
              <div className="space-y-2">
                <p>
                  Suggested preparation: <code>{result.prepareCommand}</code>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    useProjectStore.getState().updateProjectPreferences(project.id, {
                      prepareCommand: result.prepareCommand ?? undefined,
                    });
                    setSaved('Preparation saved for future tasks.');
                  }}
                >
                  Use this preparation command
                </Button>
              </div>
            ) : null}
            {savedVerify ? (
              <p>
                Verification check: <code>{savedVerify}</code>
              </p>
            ) : result.verifyCommand ? (
              <div className="space-y-2">
                <p>
                  Suggested check: <code>{result.verifyCommand}</code>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    useProjectStore.getState().updateProjectPreferences(project.id, {
                      verifyCommand: result.verifyCommand ?? undefined,
                      autoVerify: true,
                    });
                    setSaved('Automatic verification saved for future tasks.');
                  }}
                >
                  Use this check after tasks finish
                </Button>
              </div>
            ) : null}
            {savedPreview ? (
              <p>
                Preview: <code>{savedPreview}</code>
              </p>
            ) : result.previewCommand ? (
              <div className="space-y-2">
                <p>
                  Suggested preview: <code>{result.previewCommand}</code>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    useProjectStore.getState().updateProjectPreferences(project.id, {
                      previewCommand: result.previewCommand ?? undefined,
                    });
                    setSaved('Preview command saved.');
                  }}
                >
                  Use this preview command
                </Button>
              </div>
            ) : null}
            {!!result.changes && (
              <Disclosure>
                <DisclosureSummary className="min-h-11 py-3">
                  Local changes to preserve
                </DisclosureSummary>
                <pre className="task-input whitespace-pre-wrap break-words">{result.changes}</pre>
              </Disclosure>
            )}
            {result.notes.map((note) => (
              <p key={note} className="task-muted">
                {note}
              </p>
            ))}
          </>
        )}
        {saved && <p role="status">{saved}</p>}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>
    </Disclosure>
  );
}
