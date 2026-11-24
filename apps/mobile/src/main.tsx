import { applyThemeTokens, DEFAULT_THEME } from '@jackalope/brand/theme';
import { describeError } from '@jackalope/contracts/errors';
import { Button, InlineNotice } from '@jackalope/ui';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { moveNewWorkDraft } from './drafts';
import { Hosts } from './Hosts';
import { HostWork, type Opening } from './HostWork';
import { moveTo } from './motion';
import { forget, type Host, listHosts } from './native';
import { Pairing } from './Pairing';
import { Splash } from './Splash';
import { useComputers } from './useComputers';
import { Work } from './Work';
import '../../desktop/src/index.css';
import '@jackalope/ui/styles.css';
import '../../desktop/src/components/tasks/task-workspace.css';
import './mobile.css';

document.body.classList.add('mobile-body');

declare global {
  interface Window {
    /** Present only in the Android shell; returns the system bar sizes in CSS pixels as JSON. */
    JackalopeInsets?: { get(): string };
  }
}

/** Android's WebView reports zero safe-area insets, so its shell publishes them instead. */
function applyNativeInsets() {
  const raw = window.JackalopeInsets?.get();
  if (!raw) return;
  const insets = JSON.parse(raw) as Record<'top' | 'right' | 'bottom' | 'left', number>;
  for (const [side, value] of Object.entries(insets))
    document.documentElement.style.setProperty(`--safe-${side}`, `${value}px`);
}
applyNativeInsets();
window.addEventListener('jackalope-insets', applyNativeInsets);

/** How long the splash stays at least, so its mark finishes decoding instead of flashing. */
const SPLASH_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1400;

const NO_HOSTS: Host[] = [];

type Screen =
  | { kind: 'work'; hostId?: string }
  | { kind: 'computers' }
  | { kind: 'pair' }
  | { kind: 'host'; host: Host; opening: Opening; back: Screen };

/**
 * The installable companion. Work from every paired computer shows in one list; each
 * conversation opens on the computer that runs it. Requests go through the native layer
 * because the app is not served by the computers it talks to.
 */
function MobileCompanion() {
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'work' });
  const [splash, setSplash] = useState<'shown' | 'leaving' | 'gone'>('shown');
  const [error, setError] = useState('');
  // A computer just paired is greeted once on Work; the greeting clears itself.
  const [welcome, setWelcome] = useState<Host | undefined>();
  useEffect(() => {
    if (!welcome) return;
    const timer = setTimeout(() => setWelcome(undefined), 8000);
    return () => clearTimeout(timer);
  }, [welcome]);
  // A computer's own screen polls it, so the combined lists pause while one is open.
  const { computers, retry } = useComputers(
    hosts ?? NO_HOSTS,
    screen.kind === 'work' || screen.kind === 'computers',
  );
  useEffect(() => {
    const started = Date.now();
    void listHosts()
      .then(setHosts)
      .catch((cause) => {
        setHosts([]);
        setError(describeError(cause));
      })
      .finally(() => {
        const wait = Math.max(0, SPLASH_MS - (Date.now() - started));
        setTimeout(() => setSplash('leaving'), wait);
        setTimeout(() => setSplash('gone'), wait + 320);
      });
  }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const theme = () => applyThemeTokens({ ...DEFAULT_THEME, isDark: query.matches });
    theme();
    query.addEventListener('change', theme);
    return () => query.removeEventListener('change', theme);
  }, []);
  const remove = (host: Host) =>
    void forget(host.id)
      .then(() => {
        const rest = (hosts ?? []).filter((item) => item.id !== host.id);
        setHosts(rest);
        if (!rest.length) setScreen({ kind: 'work' });
      })
      .catch((cause) => setError(describeError(cause)));
  const open = (host: Host, opening: Opening, from?: HTMLElement | null) =>
    moveTo(
      () =>
        setScreen((current) => ({
          kind: 'host',
          host,
          opening,
          back: current.kind === 'host' ? current.back : current,
        })),
      from,
    );
  /** Screen changes without a source element still cross-fade where supported. */
  const go = (next: Screen) => moveTo(() => setScreen(next));
  /** New work moves to another computer, carrying the draft typed so far. */
  const switchComputer = (from: Host, to: Host) => {
    moveNewWorkDraft(localStorage, from.id, to.id);
    open(to, { composing: true });
  };
  let view = null;
  if (hosts) {
    if (screen.kind === 'pair' || !hosts.length) {
      view = (
        <Pairing
          onBack={hosts.length ? () => go({ kind: 'computers' }) : undefined}
          onPaired={(host) => {
            setHosts((current) => [
              ...(current ?? []).filter((item) => item.origin !== host.origin),
              host,
            ]);
            setWelcome(host);
            go({ kind: 'work' });
          }}
        />
      );
    } else if (screen.kind === 'host') {
      view = (
        <HostWork
          key={`${screen.host.id}:${'selected' in screen.opening ? screen.opening.selected : 'new'}`}
          host={screen.host}
          hosts={hosts}
          opening={screen.opening}
          onBack={() => go(screen.back)}
          onSwitch={(to) => switchComputer(screen.host, to)}
        />
      );
    } else if (screen.kind === 'computers') {
      view = (
        <Hosts
          hosts={hosts}
          computers={computers}
          onBack={() => go({ kind: 'work' })}
          onOpen={(host) => go({ kind: 'work', hostId: host.id })}
          onPair={() => go({ kind: 'pair' })}
          onRemove={remove}
        />
      );
    } else {
      const only = hosts.find((host) => host.id === screen.hostId);
      view = (
        <Work
          hosts={hosts}
          computers={computers}
          only={only}
          welcome={welcome}
          onOpen={(host, selected, from) => open(host, { selected }, from)}
          onCompose={(host, from) => open(host, { composing: true }, from)}
          onComputers={() => go({ kind: 'computers' })}
          onSelect={(host) => setScreen({ kind: 'work', hostId: host?.id })}
          onRetry={(host) => void retry(host)}
        />
      );
    }
  }
  return (
    <>
      {error && (
        <InlineNotice
          tone="error"
          className="mobile-app-error"
          action={
            <Button variant="outline" size="sm" onClick={() => setError('')}>
              Dismiss
            </Button>
          }
        >
          {error}
        </InlineNotice>
      )}
      {view}
      {splash !== 'gone' && <Splash leaving={splash === 'leaving'} />}
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MobileCompanion />
  </StrictMode>,
);
