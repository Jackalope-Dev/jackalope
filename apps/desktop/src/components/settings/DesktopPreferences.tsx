import { Input } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import {
  defaultShortcuts,
  displayShortcut,
  normalizeShortcut,
  resolveShortcuts,
  type ShortcutAction,
  shortcutNames,
} from '../../lib/shortcuts';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Setting, SettingGroup } from './Setting';

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
        const next = await nativeTask<DesktopActivity>('desktop_activity');
        if (!disposed) {
          setActivity(next);
          setActivityError('');
        }
      } catch (reason) {
        if (!disposed) setActivityError(String(reason));
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
      await nativeTask('desktop_keep_awake', { mode });
      setActivity(await nativeTask('desktop_activity'));
    } catch (reason) {
      setError(String(reason));
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
      <SettingGroup>
        <Setting
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
        </Setting>
        <Setting title="Interface zoom">
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
        </Setting>
        <Setting title="Preferred editor">
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
        </Setting>
        <Setting
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
        </Setting>
        <Setting title="Terminal font size">
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
        </Setting>
        <Setting
          title="Terminal links"
          description="Open clicked HTTP and HTTPS links in your default browser."
        >
          <Switch
            label="Terminal links"
            checked={settings.terminalLinks}
            onCheckedChange={(terminalLinks) => settings.updateSettings({ terminalLinks })}
          />
        </Setting>
      </SettingGroup>
      <Setting
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
      </Setting>
      {activity && (
        <section className="desktop-services" aria-label="Running services on this computer">
          <h3>Running services on this computer</h3>
          <p className="task-muted">
            {activity.awake ? 'Keeping awake' : 'Idle sleep allowed'} · {activity.activeWork} active{' '}
            {activity.activeWork === 1 ? 'attempt' : 'attempts'} · {activity.terminals}{' '}
            {activity.terminals === 1 ? 'terminal' : 'terminals'} · {activity.previews.length}{' '}
            {activity.previews.length === 1 ? 'preview' : 'previews'}
          </p>
          <div className="flex flex-wrap gap-2">
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
        </section>
      )}
      <h3>Local dictation</h3>
      <p className="task-muted">
        Connect an OpenAI-compatible transcription server running on this computer. Dictate records
        only when clicked, then adds text to your draft for review. Jackalope does not save the
        audio.
      </p>
      <SettingGroup>
        <Setting
          title="Local transcription endpoint"
          description="Leave empty to disable dictation."
        >
          <Input
            aria-label="Local transcription endpoint"
            placeholder="http://127.0.0.1:8000/v1/audio/transcriptions"
            value={settings.dictationEndpoint}
            onChange={(event) => settings.updateSettings({ dictationEndpoint: event.target.value })}
          />
        </Setting>
        <Setting title="Transcription model">
          <Input
            aria-label="Transcription model"
            value={settings.dictationModel}
            onChange={(event) => settings.updateSettings({ dictationModel: event.target.value })}
          />
        </Setting>
      </SettingGroup>
      <h3>Keyboard shortcuts</h3>
      <p className="task-muted">
        Use Mod for {displayShortcut('Mod')}. Changes apply after saving.
      </p>
      <SettingGroup>
        {(Object.keys(defaultShortcuts) as ShortcutAction[]).map((action) => (
          <Setting key={action} title={shortcutNames[action]}>
            <Input
              aria-label={`${shortcutNames[action]} shortcut`}
              value={drafts[action]}
              onChange={(event) => setDrafts({ ...drafts, [action]: event.target.value })}
            />
          </Setting>
        ))}
      </SettingGroup>
      <div className="flex gap-2">
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
      </div>
      {(error || activityError || activity?.error) && (
        <InlineNotice tone="error">{error || activityError || activity?.error}</InlineNotice>
      )}
    </>
  );
}
