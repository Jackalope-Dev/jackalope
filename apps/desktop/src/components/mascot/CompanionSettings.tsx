import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { useHelperStore } from '../../stores/helperStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { type NotificationLevel, useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';

export function CompanionSettings() {
  const helper = useHelperStore();
  const settings = useSettingsStore();
  const supported = useNotificationStore((state) => state.status?.supported);
  const native = isTauriEnvironment();
  const [localError, setLocalError] = useState('');
  const [connection, setConnection] = useState<{ url: string; token: string }>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!helper.view.connected) setConnection(undefined);
  }, [helper.view.connected]);
  const action = async (operation: () => Promise<unknown>) => {
    setLocalError('');
    try {
      await operation();
      await useHelperStore.getState().refresh();
    } catch (error) {
      setLocalError(String(error));
    }
  };
  return (
    <section className="helper-settings" aria-label="Helper settings">
      <section>
        <h3>Ask context</h3>
        <label className="helper-setting" htmlFor="helper-share-preferences">
          Appearance and preferences
          <Switch
            id="helper-share-preferences"
            label="Appearance and preferences"
            checked={helper.sharePreferences}
            onCheckedChange={(sharePreferences) => {
              useHelperStore.setState({ sharePreferences });
              void helper.refresh();
            }}
          />
        </label>
        <label className="helper-setting" htmlFor="helper-share-projects">
          Project names and task statuses
          <Switch
            id="helper-share-projects"
            label="Project names and task statuses"
            checked={helper.shareProjects}
            onCheckedChange={(shareProjects) => {
              useHelperStore.setState({ shareProjects });
              void helper.refresh();
            }}
          />
        </label>
      </section>
      <section>
        <h3>Notifications</h3>
        <Select
          aria-label="Companion notifications"
          value={settings.notifications}
          onValueChange={(value) =>
            settings.updateSettings({ notifications: value as NotificationLevel })
          }
        >
          <SelectItem value="all">All notifications</SelectItem>
          <SelectItem value="failures-only">Needs attention only</SelectItem>
          <SelectItem value="none">Quiet</SelectItem>
        </Select>
        <label className="helper-setting" htmlFor="helper-os-notifications">
          OS task notifications
          <Switch
            id="helper-os-notifications"
            label="OS task notifications"
            checked={settings.osNotifications}
            disabled={!supported}
            onCheckedChange={(osNotifications) => settings.updateSettings({ osNotifications })}
          />
        </label>
        <label className="helper-setting" htmlFor="helper-animations">
          Companion animations
          <Switch
            id="helper-animations"
            label="Companion animations"
            checked={settings.mascotReactions}
            onCheckedChange={(mascotReactions) => settings.updateSettings({ mascotReactions })}
          />
        </label>
      </section>
      <details className="helper-context">
        <summary>External agent connection</summary>
        <div className="helper-connection">
          <Button
            variant="secondary"
            size="sm"
            disabled={!native}
            onClick={() =>
              void action(async () => {
                if (helper.view.connected) {
                  await nativeTask('helper_connection', { enabled: false });
                  setConnection(undefined);
                } else setConnection(await nativeTask('helper_connection', { enabled: true }));
                setCopied(false);
              })
            }
          >
            {helper.view.connected ? 'Disconnect external agent' : 'Connect an external agent'}
          </Button>
          {helper.view.connected && (
            <p>
              Local MCP access expires after one hour or when Jackalope closes. Connected agents can
              read the context selected above and propose actions for review here.
            </p>
          )}
          {helper.view.connected && !connection && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void action(async () => {
                  setConnection(await nativeTask('helper_connection', { enabled: true }));
                  setCopied(false);
                })
              }
            >
              Replace connection to copy again
            </Button>
          )}
          {connection && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(
                    JSON.stringify(
                      {
                        mcpServers: {
                          jackalope: {
                            type: 'http',
                            url: connection.url,
                            headers: { Authorization: `Bearer ${connection.token}` },
                          },
                        },
                      },
                      null,
                      2,
                    ),
                  );
                  setCopied(true);
                })
              }
            >
              {copied ? 'Connection copied' : 'Copy MCP connection'}
            </Button>
          )}
          <button
            type="button"
            className="helper-text-button"
            onClick={() =>
              void openExternalUrl('https://jackalope.dev/knowledge/ask-jackalope/').catch(
                (error) => setLocalError(String(error)),
              )
            }
          >
            Connection instructions
          </button>
        </div>
      </details>
      {(localError || helper.syncError) && (
        <InlineNotice tone="error">{localError || helper.syncError}</InlineNotice>
      )}
    </section>
  );
}
