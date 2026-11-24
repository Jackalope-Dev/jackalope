import { Select, SelectItem, SettingBody, SettingRow } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import {
  RETENTION_CHOICES,
  type RetentionEntry,
  retentionDays,
  retentionLabel,
  worktreeName,
} from '../../lib/worktree-retention';
import { type Project, useProjectStore } from '../../stores/projectStore';

/** Project setting for automatic worktree cleanup, with what it last removed. */
export function WorktreeRetentionSetting({ project }: { project: Project }) {
  const days = retentionDays(project.preferences);
  const [log, setLog] = useState<RetentionEntry[]>([]);
  useEffect(() => {
    setLog([]);
    if (!isTauriEnvironment()) return;
    let current = true;
    invokeNative<RetentionEntry[]>('worktree_retention_log', { projectPath: project.path })
      .then((entries) => current && setLog(entries.slice(0, 5)))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [project.path]);
  return (
    <>
      <SettingRow
        title="Remove finished worktrees"
        description="Removes a task's worktree once its task is merged or archived and this long has passed. Worktrees with uncommitted changes, unmerged commits, running processes or ignored files other than dependencies and build output, such as notes, are kept. Branches stay."
        descriptionId="project-worktree-retention-description"
      >
        <Select
          aria-label="Remove finished worktrees"
          aria-describedby="project-worktree-retention-description"
          value={days === undefined ? 'off' : String(days)}
          onValueChange={(value) =>
            useProjectStore.getState().updateProjectPreferences(project.id, {
              worktreeRetentionDays: value === 'off' ? undefined : Number(value),
            })
          }
        >
          <SelectItem value="off">Never</SelectItem>
          {RETENTION_CHOICES.map((choice) => (
            <SelectItem key={choice} value={String(choice)}>
              {retentionLabel(choice)}
            </SelectItem>
          ))}
          {days !== undefined && !RETENTION_CHOICES.some((choice) => choice === days) && (
            <SelectItem value={String(days)}>{retentionLabel(days)}</SelectItem>
          )}
        </Select>
      </SettingRow>
      {log.length > 0 && (
        <SettingBody>
          <ul className="worktree-retention-log" aria-label="Recent automatic worktree cleanup">
            {log.map((entry) => (
              <li key={`${entry.at}:${entry.worktree}`}>
                {worktreeName(entry.worktree)}, {new Date(entry.at).toLocaleDateString()}:{' '}
                {entry.outcome === 'failed' ? `Could not remove it. ${entry.reason}` : entry.reason}
              </li>
            ))}
          </ul>
        </SettingBody>
      )}
    </>
  );
}
