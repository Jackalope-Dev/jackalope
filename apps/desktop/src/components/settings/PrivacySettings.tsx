import { type ReactNode, useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useCommunityStore } from '../../stores/communityStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { TitleBar } from '../layout/TitleBar';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';

export function PrivacySettings({ welcome = false }: { welcome?: boolean }) {
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
    <section className="space-y-4" aria-label="Usage privacy">
      <h2 className="text-xl font-medium">
        {welcome ? 'A quick privacy choice' : 'Usage sharing'}
      </h2>
      <p className="settings-row-description">
        Help improve Jackalope with daily counts of app opens, task outcomes, feature use, and known
        error categories, grouped by app version, stable or beta build, and operating system.
      </p>
      <p className="settings-row-description">
        No installation or account IDs, prompts, code, paths, command output, error messages, or
        stack traces are sent. Network providers receive your IP address to deliver requests;
        Jackalope does not save it in these reports. Counts are kept for 30 days.
      </p>
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
          Read the full privacy notice (opens in your browser)
        </a>
      </p>
      {noticeError && (
        <p role="alert" className="settings-row-description">
          Could not open your browser. Visit jackalope.dev/privacy to read the privacy notice.
        </p>
      )}
      {!community.settings?.configured && (
        <p className="settings-disclosure-box">
          This build has no configured reporting service. These preferences apply if you install a
          release with the service enabled.
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <span>Share anonymous usage counts</span>
        <Switch
          label="Share anonymous usage counts"
          checked={usage}
          onCheckedChange={(value) => {
            setUsage(value);
            if (!welcome) void community.save(value, errors);
          }}
          disabled={community.busy}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>Include known error categories</span>
        <Switch
          label="Include known error categories"
          checked={errors}
          onCheckedChange={(value) => {
            setErrors(value);
            if (!welcome) void community.save(usage, value);
          }}
          disabled={community.busy || !usage}
        />
      </div>
      <p className="settings-row-description">
        Sharing is optional.{' '}
        {welcome
          ? 'You can change your choice in Settings → Privacy at any time.'
          : 'Changes save immediately. You can turn sharing off here at any time.'}{' '}
        Sending written feedback is a separate action.
      </p>
      {welcome && (
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={!isTauriEnvironment() || community.busy || !community.settings}
            onClick={() => void community.save(usage, errors)}
          >
            {community.busy ? 'Saving…' : welcome ? 'Save and continue' : 'Save privacy choices'}
          </Button>
          {welcome && (
            <Button
              variant="outline"
              disabled={community.busy || !community.settings}
              onClick={() => void community.save(false, false)}
            >
              Continue without sharing
            </Button>
          )}
        </div>
      )}
      {!welcome && community.busy && <p role="status">Saving privacy choices…</p>}
      {community.error && (
        <p role="alert">
          {community.error}{' '}
          {!community.settings && (
            <Button variant="ghost" onClick={() => void community.load()}>
              Retry
            </Button>
          )}
        </p>
      )}
    </section>
  );
}
export function PrivacyGate({ children }: { children: ReactNode }) {
  const { settings, load, error } = useCommunityStore();
  useEffect(() => {
    void load();
  }, [load]);
  if (!isTauriEnvironment() || settings?.reviewed) return children;
  return (
    <div className="flex h-screen flex-col bg-surface">
      <TitleBar />
      <main className="min-h-0 flex-1 overflow-auto px-6 py-10">
        <div className="mx-auto max-w-xl">
          {settings ? (
            <PrivacySettings welcome />
          ) : (
            <>
              <p role="status">{error ?? 'Reading privacy choices…'}</p>
              {error && (
                <Button variant="outline" onClick={() => void load()}>
                  Retry
                </Button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
