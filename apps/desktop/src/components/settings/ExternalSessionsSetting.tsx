import { SettingGroup, SettingRow, Switch } from '@jackalope/ui';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAction } from '../../hooks/useAction';
import { setExternalSessionsEnabled } from '../../lib/external-sessions';
import { useExternalSessionStore } from '../../stores/externalSessionStore';
import { ActionError } from '../ui/ActionError';

/** Whether Jackalope reads Claude Code's and Codex's own session files on this device. */
export function ExternalSessionsSetting() {
  const { enabled, loaded, error, refresh } = useExternalSessionStore(
    useShallow((state) => ({
      enabled: state.enabled,
      loaded: state.loaded,
      error: state.error,
      refresh: state.refresh,
    })),
  );
  const save = useAction(refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <SettingGroup
      aria-label="Conversations outside Jackalope"
      title="Conversations outside Jackalope"
      description="Lists Claude Code and Codex conversations you had in a terminal or another app under the project they worked in, so you can read and continue them here. Jackalope reads those CLIs' session files on this device; nothing is uploaded or synced."
    >
      <SettingRow title="Show conversations from other apps">
        <Switch
          label="Show conversations from other apps"
          checked={enabled}
          disabled={!loaded || save.busy}
          onCheckedChange={(value) => void save.run(() => setExternalSessionsEnabled(value))}
        />
      </SettingRow>
      <ActionError error={save.error || (enabled ? error : null)} />
    </SettingGroup>
  );
}
