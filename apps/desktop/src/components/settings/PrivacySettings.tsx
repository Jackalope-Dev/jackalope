import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useCommunityStore } from '../../stores/communityStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import { SettingsSync } from './SettingsSync';

export function PrivacySettings() {
  const community = useCommunityStore();
  const legacy = useSettingsStore();
  const [noticeError, setNoticeError] = useState(false);
  const [usage, setUsage] = useState(
    community.settings?.reviewed ? community.settings.telemetry : legacy.telemetryEnabled,
  );
  const [errors, setErrors] = useState(
    community.settings?.reviewed ? community.settings.errors : legacy.crashReportingEnabled,
  );
  useEffect(() => {
    void community.load();
  }, [community.load]);
  useEffect(() => {
    if (community.settings?.reviewed) {
      setUsage(community.settings.telemetry);
      setErrors(community.settings.errors);
    }
  }, [community.settings]);
  return (
    <section className="space-y-4" aria-label="Privacy settings">
      <SettingsSync />
      <h2 className="text-xl font-medium">Usage sharing</h2>
      <div className="flex items-center justify-between gap-4">
        <span>Share anonymous usage counts</span>
        <Switch
          label="Share anonymous usage counts"
          checked={usage}
          onCheckedChange={(value) => {
            setUsage(value);
            void community.save(value, errors);
          }}
          disabled={community.busy || !community.settings}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>Include known error categories</span>
        <Switch
          label="Include known error categories"
          checked={errors}
          onCheckedChange={(value) => {
            setErrors(value);
            void community.save(usage, value);
          }}
          disabled={community.busy || !community.settings || !usage}
        />
      </div>
      <p className="settings-row-description">
        Optional daily counts to improve Jackalope. No prompts, code or account IDs. Kept for 30
        days.
      </p>
      <details className="space-y-2">
        <summary className="min-h-11 cursor-pointer py-3 text-sm rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
          What gets shared
        </summary>
        <p className="settings-row-description">
          Counts of app opens, task outcomes and feature use, plus known error categories if
          enabled. Grouped by app version, release channel and operating system.
        </p>
        <p className="settings-row-description">
          No installation or account IDs, prompts, code, paths, command output, error messages or
          stack traces. Network providers receive your IP address to deliver requests; Jackalope
          does not save it in reports. Written feedback is separate.
        </p>
      </details>
      <p className="settings-row-description">
        <a
          href="https://jackalope.dev/privacy/"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          onClick={async (event) => {
            if (!isTauriEnvironment()) return;
            event.preventDefault();
            try {
              const { open } = await import('@tauri-apps/plugin-shell');
              await open('https://jackalope.dev/privacy/');
              setNoticeError(false);
            } catch {
              setNoticeError(true);
            }
          }}
        >
          Full privacy notice ↗
        </a>
      </p>
      {noticeError && (
        <p role="alert" className="settings-row-description">
          Could not open your browser. Visit jackalope.dev/privacy to read the privacy notice.
        </p>
      )}
      {community.settings && !community.settings.configured && (
        <p className="settings-disclosure-box">
          Reporting is unavailable in this build. Your choices are saved for supported releases.
        </p>
      )}
      {community.busy && <p role="status">Saving privacy choices…</p>}
      {community.error && (
        <p role="alert">
          {community.error}{' '}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              void (community.settings ? community.save(usage, errors) : community.load())
            }
          >
            Retry
          </Button>
        </p>
      )}
    </section>
  );
}
