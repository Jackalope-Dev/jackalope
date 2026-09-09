import { EchoMark } from '@jackalope/brand/echo';
import { ArrowRight, ChevronDown, FolderOpen, ShieldCheck } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useCommunityStore } from '../../stores/communityStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdateStore } from '../../stores/updateStore';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { type AccountStatus, JackalopeAccount } from '../settings/JackalopeAccount';
import { PrivacySettings } from '../settings/PrivacySettings';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import './access.css';

interface AccessStatus {
  required: boolean;
  allowed: boolean;
  validUntil: number | null;
}

export function AccessBoundary({ children }: { children: ReactNode }) {
  const onboarding = useOnboardingStore((state) => state.status);
  const hasProjects = useProjectStore((state) => state.projects.length > 0);
  const settings = useSettingsStore();
  const version = useUpdateStore((state) => state.release?.currentVersion);
  const loadRelease = useUpdateStore((state) => state.load);
  const reducedMotion = useReducedMotion();
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [admitted, setAdmitted] = useState(false);
  const entered = useRef(false);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const needsSetup = onboarding === 'new' || onboarding === 'active';
  useEffect(() => {
    void loadRelease();
  }, [loadRelease]);
  useEffect(() => {
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = isTauriEnvironment()
          ? await nativeTask<AccessStatus>('app_execution_access')
          : { required: false, allowed: true, validUntil: null };
        if (!canceled) setAccess(value);
      } catch {
        if (!canceled) {
          setAccess(null);
          setError('We couldn’t check your access. Reconnect or retry shortly.');
        }
      }
      if (!canceled) timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!access?.allowed || (entered.current && !connecting) || verified) return;
    if (!access.required && account?.state !== 'connected') {
      if (!needsSetup && !connecting) setAdmitted(true);
      return;
    }
    let canceled = false;
    void useCommunityStore
      .getState()
      .applyDefaults()
      .then(() => {
        const privacy = useCommunityStore.getState();
        if (canceled) return;
        if (privacy.error) {
          setError(privacy.error);
          return;
        }
        if (privacy.busy || (isTauriEnvironment() && !privacy.settings?.reviewed)) return;
        setError('');
        setVerified(true);
      });
    return () => {
      canceled = true;
    };
  }, [access, account?.state, connecting, needsSetup, verified]);
  useEffect(() => {
    if (!verified) return;
    if (!access?.allowed) {
      setVerified(false);
      return;
    }
    successHeading.current?.focus();
    const timer = setTimeout(
      () => {
        entered.current = true;
        setAdmitted(true);
        setConnecting(false);
        setVerified(false);
      },
      reducedMotion ? 450 : 1450,
    );
    return () => clearTimeout(timer);
  }, [verified, access?.allowed, reducedMotion]);
  if (admitted) entered.current = true;
  if (!connecting && (admitted || reviewing))
    return (
      <div className="access-frame">
        {!access?.allowed && (
          <div className="access-notice">
            <p role="status">
              Connect an approved account to start new work. Saved work and running tasks remain
              available.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setVerified(false);
                setConnecting(true);
              }}
            >
              Connect account
            </Button>
          </div>
        )}
        <div className="access-workspace">{children}</div>
      </div>
    );
  return (
    <div className="access-frame">
      <ResizeHandles />
      <TitleBar />
      <main className="access-page">
        {settings.showThemePickerInToolbar && (
          <div className="access-appearance">
            <ArcColorPicker scope="app" />
          </div>
        )}
        <div className="access-atmosphere" aria-hidden="true" />
        {verified ? (
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
            <p role="status">
              Access confirmed.{' '}
              {needsSetup ? 'Let’s set up your project.' : 'Welcome back to Jackalope.'}
            </p>
          </section>
        ) : (
          <section className="access-welcome" aria-labelledby="access-heading">
            <header className="access-intro">
              <EchoMark animated={false} className="access-mark" />
              <h1 id="access-heading">Welcome to Jackalope.</h1>
              <p>Connect your account to check early access.</p>
            </header>
            <details className="access-privacy">
              <summary>
                <ShieldCheck size={20} />
                <span>
                  <strong>App preferences & privacy</strong>
                  <small>
                    Settings sync is on for new connections. Review or turn it off here.
                  </small>
                </span>
                <ChevronDown size={18} />
              </summary>
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
              </div>
            </details>
            <div className="access-connection">
              {!access && !error ? (
                <p className="access-checking" role="status">
                  Checking access…
                </p>
              ) : (
                <JackalopeAccount presentation="welcome" onStatus={setAccount} />
              )}
              {error && (
                <p className="access-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="access-footer">
              {access && !access.required && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await useCommunityStore.getState().applyDefaults();
                    const privacy = useCommunityStore.getState();
                    if (privacy.error) {
                      setError(privacy.error);
                      return;
                    }
                    setAdmitted(true);
                  }}
                >
                  Continue in development build
                  <ArrowRight size={16} />
                </Button>
              )}
              {hasProjects && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    useOnboardingStore.getState().finish();
                    setReviewing(true);
                    setConnecting(false);
                  }}
                >
                  <FolderOpen size={16} />
                  Open saved work
                  <ArrowRight size={14} />
                </Button>
              )}
            </footer>
          </section>
        )}
        <p className="access-caption">Jackalope{version ? ` v${version}` : ''} · Early access</p>
      </main>
    </div>
  );
}
