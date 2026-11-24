import { Button, SettingGroup, SettingRow } from '@jackalope/ui';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { openHistoryImport } from '../../lib/app-events';
import { useImportedConversationStore } from '../../stores/importedConversationStore';
import { ActionError } from '../ui/ActionError';

/** Imports Claude Code and Codex conversations from this computer into Jackalope. */
export function HistoryImportSetting() {
  const { conversations, progress, error, refresh } = useImportedConversationStore(
    useShallow((state) => ({
      conversations: state.conversations.length,
      progress: state.progress,
      error: state.error,
      refresh: state.refresh,
    })),
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const status = progress?.running
    ? `Importing ${Math.min(progress.done + 1, progress.total).toLocaleString()} of ${progress.total.toLocaleString()}…`
    : conversations
      ? `${conversations.toLocaleString()} ${conversations === 1 ? 'conversation' : 'conversations'} imported.`
      : undefined;
  return (
    <SettingGroup
      aria-label="Claude Code and Codex history"
      title="Claude Code and Codex history"
      description="Copy conversations you had with Claude Code or Codex on this computer into Jackalope, under the project they ran in. Their own files are only read."
    >
      <SettingRow title="Import Claude and Codex history" description={status}>
        <Button variant="outline" onClick={openHistoryImport}>
          {progress?.running ? 'Show progress' : 'Import…'}
        </Button>
      </SettingRow>
      <ActionError error={error} />
    </SettingGroup>
  );
}
