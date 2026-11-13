import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  FieldCheck,
  InlineNotice,
  Input,
  Select,
  SelectItem,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
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
  return (
    <>
      <SettingGroup title="Display & editor" data-settings-tile>
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
      <SettingGroup title="Terminal" data-settings-tile>
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
      <SettingGroup title="Power" data-settings-tile>
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
        data-settings-tile
        title="Local dictation"
        description="Connect an OpenAI-compatible transcription server running on this computer. Dictate records only when clicked, then adds text to your draft for review. Jackalope does not save the audio."
      >
        <SettingRow
          title="Local transcription endpoint"
          description="Leave empty to disable dictation."
        >
          <div className="settings-field-stack">
            <Input
              aria-label="Local transcription endpoint"
              aria-describedby="dictation-endpoint-check"
              placeholder="http://127.0.0.1:8000/v1/audio/transcriptions"
              value={settings.dictationEndpoint}
              onChange={(event) =>
                settings.updateSettings({ dictationEndpoint: event.target.value })
              }
            />
            <DictationCheck endpoint={settings.dictationEndpoint} />
          </div>
        </SettingRow>
        <SettingRow title="Transcription model">
          <Input
            aria-label="Transcription model"
            value={settings.dictationModel}
            onChange={(event) => settings.updateSettings({ dictationModel: event.target.value })}
          />
        </SettingRow>
      </SettingGroup>
      {(error || activityError || activity?.error) && (
        <InlineNotice tone="error">{error || activityError || activity?.error}</InlineNotice>
      )}
    </>
  );
}

/** What the endpoint field means right now, from the same URL rule the dictation request uses. */
function dictationState(endpoint: string): { tone: 'ok' | 'error' | 'info'; message: string } {
  const value = endpoint.trim();
  if (!value) return { tone: 'info', message: 'Dictation is off. Add an endpoint to turn it on.' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { tone: 'error', message: 'Enter a full address, such as http://127.0.0.1:8000/…' };
  }
  if (!['http:', 'https:'].includes(url.protocol))
    return { tone: 'error', message: 'Use an http:// or https:// address.' };
  return {
    tone: 'ok',
    message: `Dictation sends recordings to ${url.host} when you click Dictate.`,
  };
}

function DictationCheck({ endpoint }: { endpoint: string }) {
  const state = dictationState(endpoint);
  return (
    <FieldCheck id="dictation-endpoint-check" tone={state.tone}>
      {state.message}
    </FieldCheck>
  );
}
