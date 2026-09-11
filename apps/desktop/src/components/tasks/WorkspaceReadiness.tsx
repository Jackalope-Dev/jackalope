import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
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
}: {
  project: Project;
  path?: string;
}) {
  const [result, setResult] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  return (
    <details className="my-4">
      <summary className="min-h-11 py-3">Workspace readiness</summary>
      <div className="space-y-3">
        <p className="task-muted">
          Inspect setup, local changes and configuration names. Suggested commands remain editable
          in project settings.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            setResult(null);
            try {
              setResult(await nativeTask<Readiness>('project_readiness', { path }));
            } catch (cause) {
              setError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Inspecting…' : 'Inspect workspace setup'}
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
            {result.prepareCommand && (
              <div className="space-y-2">
                <p>
                  Suggested preparation: <code>{result.prepareCommand}</code>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    useProjectStore.getState().updateProjectPreferences(project.id, {
                      prepareCommand: result.prepareCommand ?? undefined,
                    });
                    setSaved(
                      'Preparation saved for future tasks. Existing attempts keep their original setup.',
                    );
                  }}
                >
                  Use this preparation command
                </Button>
                <p className="task-muted">
                  Saving authorizes this command in future task workspaces; package installation can
                  execute repository and dependency scripts.
                </p>
              </div>
            )}
            {result.verifyCommand && (
              <div className="space-y-2">
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
                    setSaved('Automatic verification saved for future tasks.');
                  }}
                >
                  Use this check after tasks finish
                </Button>
              </div>
            )}
            {!!result.changes && (
              <details>
                <summary className="min-h-11 py-3">Local changes to preserve</summary>
                <pre className="task-input whitespace-pre-wrap break-words">{result.changes}</pre>
              </details>
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
    </details>
  );
}
