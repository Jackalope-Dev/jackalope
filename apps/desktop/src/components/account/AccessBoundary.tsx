import { EchoMark } from '@jackalope/brand/echo';
import { Button, Disclosure, DisclosureSummary, DiscordIcon, Switch } from '@jackalope/ui';
import { ShieldCheck } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type AccountStatus, accountAccess } from '../../lib/account';
import { DISCORD_URL } from '../../lib/community';
import { openExternalUrl } from '../../lib/native/env';
import { WindowGlass } from '../../lib/window-glass';
import { useAccountPromptStore, useAccountStore } from '../../stores/accountStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdateStore } from '../../stores/updateStore';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { JackalopeAccount } from '../settings/JackalopeAccount';
import { PrivacySettings } from '../settings/PrivacySettings';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { AccountSuggestion } from './AccountPrompts';
import './access.css';

/** The workspace's slot below its title bar, for the one account suggestion. */
export function AccessNoticeSlot() {
  return <AccountSuggestion />;
}

const today = () => new Date().toLocaleDateString('en-CA');
const connected = (status: AccountStatus | null) => accountAccess(status) === 'approved';

/**
 * First-run welcome. Connecting an account is the primary path; continuing
 * without one goes straight to project setup, since local work never needs an
 * account. Returning people, connected or not, go straight to their work.
 */
export function AccessBoundary({ children }: { children: ReactNode }) {
  const onboarding = useOnboardingStore((state) => state.status);
  const skipped = useAccountPromptStore((state) => state.skippedAt !== null);
  const account = useAccountStore((state) => state.status);
  const settings = useSettingsStore();
  const version = useUpdateStore((state) => state.release?.currentVersion);
  const loadRelease = useUpdateStore((state) => state.load);
  const reducedMotion = useReducedMotion();
  const needsSetup = onboarding === 'new' || onboarding === 'active';
  const [phase, setPhase] = useState<'welcome' | 'verified' | 'admitted'>(() =>
    needsSetup && !skipped ? 'welcome' : 'admitted',
  );
  const [error, setError] = useState('');
  const [entering, setEntering] = useState(false);
  const successHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    void loadRelease();
  }, [loadRelease]);
  useEffect(() => {
    useAccountPromptStore.getState().visit(today());
    void useAccountStore.getState().load(true);
  }, []);
  /** Saves the privacy defaults reviewed here; a failure keeps the person on this screen. */
  const enter = useCallback(async () => {
    await useCommunityStore.getState().applyDefaults();
    const privacy = useCommunityStore.getState();
    if (privacy.error) {
      setError(privacy.error);
      return false;
    }
    setError('');
    return true;
  }, []);
  useEffect(() => {
    // Setup can turn out to be finished once saved projects load.
    if (phase === 'welcome' && !needsSetup) setPhase('admitted');
    if (phase === 'admitted') void useCommunityStore.getState().applyDefaults();
  }, [phase, needsSetup]);
  useEffect(() => {
    if (phase !== 'welcome' || !connected(account)) return;
    let canceled = false;
    void enter().then((ok) => {
      if (ok && !canceled) setPhase('verified');
    });
    return () => {
      canceled = true;
    };
  }, [phase, account, enter]);
  useEffect(() => {
    if (phase !== 'verified') return;
    successHeading.current?.focus();
    const timer = setTimeout(() => setPhase('admitted'), reducedMotion ? 450 : 1450);
    return () => clearTimeout(timer);
  }, [phase, reducedMotion]);
  if (phase === 'admitted') return children;
  const continueWithout = async () => {
    if (entering) return;
    setEntering(true);
    const ok = await enter();
    setEntering(false);
    if (!ok) return;
    useAccountPromptStore.getState().skip();
    setPhase('admitted');
  };
  const access = accountAccess(account);
  return (
    <div className="access-frame">
      <WindowGlass />
      <ResizeHandles />
      <TitleBar />
      <main className="access-page">
        {settings.showThemePickerInToolbar && (
          <div className="access-appearance">
            <ArcColorPicker scope="app" />
          </div>
        )}
        <div className="access-atmosphere" aria-hidden="true" />
        {phase === 'verified' ? (
          <section
            className="access-welcome access-verified"
            aria-labelledby="access-verified-heading"
          >
            <div className="access-validation" aria-hidden="true">
              <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
                <circle className="access-validation-halo" cx="60" cy="60" r="53" />
                <circle className="access-validation-ring" cx="60" cy="60" r="43" pathLength="1" />
                <path className="access-validation-check" d="m39 61 14 14 29-31" pathLength="1" />
              </svg>
            </div>
            <h1 id="access-verified-heading" ref={successHeading} tabIndex={-1}>
              You’re in.
            </h1>
            <p role="status">Let’s set up your project.</p>
          </section>
        ) : (
          <section className="access-welcome" aria-labelledby="access-heading">
            <header className="access-intro">
              <EchoMark animated={false} className="access-mark" />
              <h1 id="access-heading">Welcome to Jackalope.</h1>
              <p>Create a free account or sign in, or start right away and connect later.</p>
            </header>
            <Disclosure className="access-privacy">
              <DisclosureSummary>
                <ShieldCheck size={20} />
                <span>
                  <strong>App preferences & privacy</strong>
                  <small>
                    Settings sync is on for new connections. Review or turn it off here.
                  </small>
                </span>
              </DisclosureSummary>
              <div className="access-privacy-controls">
                <PrivacySettings />
                <div className="flex items-center justify-between gap-4">
                  <span>Browse community tools</span>
                  <Switch
                    label="Allow MCP marketplace"
                    checked={settings.useMcpMarketplace}
                    onCheckedChange={settings.setUseMcpMarketplace}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Theme picker in the top bar</span>
                  <Switch
                    label="Show theme picker in top bar"
                    checked={settings.showThemePickerInToolbar}
                    onCheckedChange={(checked) =>
                      settings.updateSettings({ showThemePickerInToolbar: checked })
                    }
                  />
                </div>
              </div>
            </Disclosure>
            <div className="access-connection">
              <JackalopeAccount presentation="welcome" />
              <div className="access-skip">
                <Button
                  variant="outline"
                  loading={entering}
                  loadingLabel="Opening Jackalope…"
                  onClick={() => void continueWithout()}
                >
                  {access === 'pending' || access === 'waitlist'
                    ? 'Continue to Jackalope'
                    : 'Continue without an account'}
                </Button>
                <p>
                  Tasks, conversations and terminals run with your own agents either way. An account
                  adds sync across your computers, invitations and beta access.
                </p>
              </div>
              {error && (
                <p className="access-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="access-footer">
              <div className="access-learn-links">
                <Button
                  variant="ghost"
                  onClick={() => void openExternalUrl('https://jackalope.dev/tour/')}
                >
                  Watch the app tour
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void openExternalUrl('https://jackalope.dev/')}
                >
                  About Jackalope
                </Button>
                <Button variant="ghost" onClick={() => void openExternalUrl(DISCORD_URL)}>
                  <DiscordIcon size={16} />
                  Join Discord
                </Button>
              </div>
            </footer>
          </section>
        )}
        <p className="access-caption">Jackalope{version ? ` v${version}` : ''}</p>
      </main>
    </div>
  );
}
