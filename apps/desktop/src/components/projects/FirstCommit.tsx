import { Button, ConfirmDialog, InlineNotice } from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import { describeError } from '@jackalope/contracts/errors';
import {
  createFirstCommit,
  type FirstCommitPreview,
  firstCommitPreview,
} from '../../lib/project-git';

const IDENTITY_FIX =
  'git config --global user.name "Your Name"\ngit config --global user.email you@example.com';

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;

/**
 * Offers a first commit for a repository without one. Shows what would be committed
 * and asks before committing; refuses without a configured Git identity.
 */
export function FirstCommit({
  projectPath,
  reason,
  onCommitted,
}: {
  projectPath: string;
  /** What needs the commit, such as "Artifacts needs at least one commit." */
  reason: string;
  onCommitted: () => void;
}) {
  const [preview, setPreview] = useState<FirstCommitPreview>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setPreview(await firstCommitPreview(projectPath));
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [projectPath]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <InlineNotice
        tone="error"
        action={
          <Button variant="outline" onClick={() => void load()}>
            Check again
          </Button>
        }
      >
        {error}
      </InlineNotice>
    );
  if (!preview) return null;
  if (!preview.identity)
    return (
      <InlineNotice
        tone="warning"
        action={
          <Button variant="outline" onClick={() => void load()}>
            Check again
          </Button>
        }
      >
        {reason} Set your Git name and email first:
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{IDENTITY_FIX}</pre>
      </InlineNotice>
    );
  const { identity } = preview;
  return (
    <InlineNotice
      action={
        <ConfirmDialog
          title="Create the first commit?"
          description={`Commits ${files(preview.files)} as ${identity.name} <${identity.email}> with the message “Initial commit”. Files matched by .gitignore are left out.`}
          label="Commit"
          busyLabel="Committing…"
          variant="primary"
          onConfirm={async () => {
            await createFirstCommit(projectPath, preview.files);
            onCommitted();
          }}
          trigger={<Button variant="outline">Create first commit</Button>}
        />
      }
    >
      {reason} This repository has no commits yet. Files to commit: {preview.files}.
    </InlineNotice>
  );
}
