import {
  Button,
  InlineNotice,
  Input,
  Select,
  SelectItem,
  SettingActions,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import { describeError } from '@jackalope/contracts/errors';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import {
  defaultShortcuts,
  displayShortcut,
  normalizeShortcut,
  resolveShortcuts,
  type ShortcutAction,
  shortcutNames,
} from '../../lib/shortcuts';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { CliCommandSetting } from './CliCommandSetting';

export interface DesktopActivity {
  mode: 'off' | 'working' | 'always';
  awake: boolean;
  activeWork: number;
  error: string | null;
  terminals: number;
  previews: [string, number][];
}
export function DesktopPreferences() {
  const settings = useSettingsStore();
  const [activity, setActivity] = useState<DesktopActivity>();
  const [activityError, setActivityError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const bindings = resolveShortcuts(settings.shortcuts);
  const [drafts, setDrafts] = useState(bindings);
  const windows = /Win/i.test(navigator.platform);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const next = await invokeNative<DesktopActivity>('desktop_activity');
        if (!disposed) {
          setActivity(next);
          setActivityError('');
        }
      } catch (reason) {
        if (!disposed) setActivityError(describeError(reason));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  const awake = async (mode: DesktopActivity['mode']) => {
    setSaving(true);
    setError('');
    try {
      await invokeNative('desktop_keep_awake', { mode });
      setActivity(await invokeNative('desktop_activity'));
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setSaving(false);
    }
  };
  const saveShortcuts = () => {
    const next = Object.fromEntries(
      Object.entries(drafts).map(([action, value]) => [action, normalizeShortcut(value)]),
    );
    if (Object.values(next).some((value) => !value)) {
      setError(
        'Use Mod plus a key, optionally Shift or Alt. Common editing and system shortcuts are reserved.',
      );
      return;
    }
    if (new Set(Object.values(next)).size !== Object.keys(next).length) {
      setError('Choose a different shortcut for each action.');
      return;
    }
    settings.updateSettings({ shortcuts: next as Record<string, string> });
    setError('');
  };
  return (
    <>
      <SettingGroup title="Display & editor">
        <SettingRow title="Interface zoom">
          <Select
            aria-label="Interface zoom"
            value={String(settings.interfaceZoom)}
            onValueChange={(value) => settings.updateSettings({ interfaceZoom: Number(value) })}
          >
            {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((value) => (
              <SelectItem key={value} value={String(value)}>
                {Math.round(value * 100)}%
              </SelectItem>
            ))}
          </Select>
        </SettingRow>
        <SettingRow title="Preferred editor">
          <Select
            aria-label="Preferred editor"
            value={settings.preferredEditor}
            onValueChange={(value) =>
              settings.updateSettings({ preferredEditor: value as 'vscode' | 'cursor' })
            }
          >
            <SelectItem value="vscode">VS Code</SelectItem>
            <SelectItem value="cursor">Cursor</SelectItem>
          </Select>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Terminal">
        <SettingRow
          title="Terminal shell"
          description="Applies when starting a terminal. WSL terminals do not change the environment used by agents or checks."
        >
          <Select
            aria-label="Terminal shell"
            value={settings.terminalShell}
            onValueChange={(value) =>
              settings.updateSettings({ terminalShell: value as typeof settings.terminalShell })
            }
          >
            <SelectItem value="default">System default</SelectItem>
            {(windows
              ? [
                  ['powershell', 'Windows PowerShell'],
                  ['pwsh', 'PowerShell 7'],
                  ['cmd', 'Command Prompt'],
                  ['wsl', 'WSL default distribution'],
                ]
              : [
                  ['bash', 'Bash'],
                  ['zsh', 'Zsh'],
                ]
            ).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </Select>
        </SettingRow>
        <SettingRow title="Terminal font size">
          <Select
            aria-label="Terminal font size"
            value={String(settings.terminalFontSize)}
            onValueChange={(value) => settings.updateSettings({ terminalFontSize: Number(value) })}
          >
            {[11, 12, 13, 14, 16, 18, 20].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}px
              </SelectItem>
            ))}
          </Select>
        </SettingRow>
        <SettingRow
          title="Terminal links"
          description="Open clicked HTTP and HTTPS links in your default browser."
        >
          <Switch
            label="Terminal links"
            checked={settings.terminalLinks}
            onCheckedChange={(terminalLinks) => settings.updateSettings({ terminalLinks })}
          />
        </SettingRow>
        <CliCommandSetting />
        <SettingRow
          title="Restore terminal output"
          description="Save the last 256 KiB when a terminal stops or Jackalope quits. After restarting, output is read-only until you start a new shell. Applies to newly started terminals."
        >
          <Switch
            label="Restore terminal output"
            checked={settings.retainTerminalOutput}
            onCheckedChange={(retainTerminalOutput) =>
              settings.updateSettings({ retainTerminalOutput })
            }
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Power">
        <SettingRow
          title="Keep computer awake"
          description="Prevent idle sleep while Jackalope is open. While working covers agent runs and finishing checks; it releases when they finish. Your display can still sleep. Explicit sleep and closing the lid follow your system settings."
        >
          <Select
            aria-label="Keep computer awake"
            value={activity?.mode ?? 'off'}
            disabled={!activity || saving}
            onValueChange={(value) => void awake(value as DesktopActivity['mode'])}
          >
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="working">While work runs</SelectItem>
            <SelectItem value="always">While Jackalope is open</SelectItem>
          </Select>
        </SettingRow>
        {activity && (
          <SettingRow
            title="Running on this computer"
            description={`${activity.awake ? 'Keeping awake' : 'Idle sleep allowed'} · ${activity.activeWork} active ${
              activity.activeWork === 1 ? 'attempt' : 'attempts'
            } · ${activity.terminals} ${activity.terminals === 1 ? 'terminal' : 'terminals'} · ${
              activity.previews.length
            } ${activity.previews.length === 1 ? 'preview' : 'previews'}`}
          >
            <div className="flex flex-wrap justify-end gap-2">
              {activity.previews.map(([id, port]) => (
                <Button
                  key={id}
                  variant="outline"
                  onClick={() => {
                    useWorkViewStore.getState().open(id, 'preview');
                    navigateWorkspace('kanban');
                  }}
                >
                  Preview on port {port}
                </Button>
              ))}
              <Button variant="outline" onClick={() => navigateWorkspace('worktrees')}>
                Inspect worktrees and disk use
              </Button>
            </div>
          </SettingRow>
        )}
      </SettingGroup>
      <SettingGroup
        title="Local dictation"
        description="Connect an OpenAI-compatible transcription server running on this computer. Dictate records only when clicked, then adds text to your draft for review. Jackalope does not save the audio."
      >
        <SettingRow
          title="Local transcription endpoint"
          description="Leave empty to disable dictation."
        >
          <Input
            aria-label="Local transcription endpoint"
            placeholder="http://127.0.0.1:8000/v1/audio/transcriptions"
            value={settings.dictationEndpoint}
            onChange={(event) => settings.updateSettings({ dictationEndpoint: event.target.value })}
          />
        </SettingRow>
        <SettingRow title="Transcription model">
          <Input
            aria-label="Transcription model"
            value={settings.dictationModel}
            onChange={(event) => settings.updateSettings({ dictationModel: event.target.value })}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup
        title="Keyboard shortcuts"
        description={`Use Mod for ${displayShortcut('Mod')}. Changes apply after saving.`}
      >
        {(Object.keys(defaultShortcuts) as ShortcutAction[]).map((action) => (
          <SettingRow key={action} title={shortcutNames[action]}>
            <Input
              aria-label={`${shortcutNames[action]} shortcut`}
              value={drafts[action]}
              onChange={(event) => setDrafts({ ...drafts, [action]: event.target.value })}
            />
          </SettingRow>
        ))}
        <SettingActions>
          <Button variant="outline" onClick={saveShortcuts}>
            Save shortcuts
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              settings.updateSettings({ shortcuts: {} });
              setDrafts(defaultShortcuts);
              setError('');
            }}
          >
            Restore defaults
          </Button>
        </SettingActions>
      </SettingGroup>
      {(error || activityError || activity?.error) && (
        <InlineNotice tone="error">{error || activityError || activity?.error}</InlineNotice>
      )}
    </>
  );
}
