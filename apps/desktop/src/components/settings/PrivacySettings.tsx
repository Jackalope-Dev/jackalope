import {
  Button,
  Disclosure,
  DisclosureSummary,
  SettingBody,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isTauriEnvironment, openInBrowser } from '../../lib/native/env';
import { useCommunityStore } from '../../stores/communityStore';
import { useLessonSyncStore } from '../../stores/lessonSyncStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSettingsSyncStore } from '../../stores/settingsSyncStore';
import { ExternalSessionsSetting } from './ExternalSessionsSetting';
import { SettingsSync } from './SettingsSync';

export function PrivacySettings() {
  const community = useCommunityStore(
    useShallow((s) => ({
      settings: s.settings,
      load: s.load,
      save: s.save,
      busy: s.busy,
      error: s.error,
    })),
  );
  const legacy = useSettingsStore(
    useShallow((s) => ({
      telemetryEnabled: s.telemetryEnabled,
      crashReportingEnabled: s.crashReportingEnabled,
    })),
  );
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
    <>
      <PrivacySummary usage={usage} errors={errors} />
      <SettingsSync />
      <SettingGroup
        aria-label="Usage sharing"
        title="Usage sharing"
        description="Optional daily counts to improve Jackalope. No prompts, code or account IDs. Kept for 30 days."
      >
        <SettingRow title="Share anonymous usage counts">
          <Switch
            label="Share anonymous usage counts"
            checked={usage}
            onCheckedChange={(value) => {
              setUsage(value);
              void community.save(value, errors);
            }}
            disabled={community.busy || !community.settings}
          />
        </SettingRow>
        <SettingRow title="Include known error categories">
          <Switch
            label="Include known error categories"
            checked={errors}
            onCheckedChange={(value) => {
              setErrors(value);
              void community.save(usage, value);
            }}
            disabled={community.busy || !community.settings || !usage}
          />
        </SettingRow>
        <SettingBody>
          <Disclosure className="space-y-2">
            <DisclosureSummary className="min-h-11 cursor-pointer py-3 text-sm rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
              What gets shared
            </DisclosureSummary>
            <p className="settings-row-description">
              Counts of app opens, page visits, operation outcomes and task states by agent and task
              or conversation workflow, plus known error categories if enabled. Grouped by app
              version, release channel and operating system. Operation outcomes include failed
              requests and checks.
            </p>
            <p className="settings-row-description">
              No installation or account IDs, prompts, code, paths, command output, error messages
              or stack traces. Network providers receive your IP address to deliver requests;
              Jackalope does not save it in reports. Written feedback is separate.
            </p>
          </Disclosure>
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
                  await openInBrowser('https://jackalope.dev/privacy/');
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
              Could not open your browser. Visit jackalope.dev/privacy/ to read the privacy notice.
            </p>
          )}
          {community.settings && !community.settings.configured && (
            <p className="settings-row-description">
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
        </SettingBody>
      </SettingGroup>
      {isTauriEnvironment() && <ExternalSessionsSetting />}
    </>
  );
}

/**
 * What leaves this computer, read from the same switches below: nothing here is decorative, and
 * each line changes as soon as its switch does.
 */
function PrivacySummary({ usage, errors }: { usage: boolean; errors: boolean }) {
  const sync = useSettingsSyncStore((state) => state.enabled && Boolean(state.owner));
  const lessons = useLessonSyncStore((state) => state.view.enabled);
  const outgoing = [
    { label: 'Settings sync', on: sync, detail: 'Preferences, to your Jackalope account' },
    {
      label: 'Learned lessons',
      on: sync && lessons,
      detail: 'With settings sync, to your account',
    },
    { label: 'Usage counts', on: usage, detail: 'Anonymous daily counts' },
    { label: 'Error categories', on: usage && errors, detail: 'Known categories only' },
  ];
  return (
    <SettingGroup aria-label="What leaves this computer" title="What leaves this computer">
      <SettingBody>
        <ul className="privacy-summary" aria-label="Outgoing data">
          {outgoing.map((item) => (
            <li key={item.label} className="privacy-summary-item" data-on={item.on || undefined}>
              <span className="privacy-summary-state">{item.on ? 'On' : 'Off'}</span>
              <span>
                <strong>{item.label}</strong>
                <span className="settings-row-description">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="settings-row-description">
          Always stays here: your code, prompts, file paths, command output and project secrets.
        </p>
      </SettingBody>
    </SettingGroup>
  );
}
