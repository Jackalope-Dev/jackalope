import { applyThemeTokens, DEFAULT_THEME } from '@jackalope/brand/theme';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InlineNotice } from '../../desktop/src/components/ui/InlineNotice';
import { Hosts } from './Hosts';
import { HostWork } from './HostWork';
import { forget, type Host, listHosts } from './native';
import { Pairing } from './Pairing';
import { Splash } from './Splash';
import '../../desktop/src/index.css';
import '../../desktop/src/components/ui/experience.css';
import '../../desktop/src/components/tasks/task-workspace.css';
import './mobile.css';

document.body.classList.add('mobile-body');

/** How long the splash stays at least, so its mark finishes decoding instead of flashing. */
const SPLASH_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1400;

type Screen = { kind: 'hosts' } | { kind: 'pair' } | { kind: 'host'; host: Host };

/**
 * The installable companion. One paired computer opens straight to its work; with several,
 * Computers lists them. Requests go through the native layer because the app is not served
 * by the computer it talks to.
 */
function MobileCompanion() {
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'hosts' });
  const [splash, setSplash] = useState<'shown' | 'leaving' | 'gone'>('shown');
  const [error, setError] = useState('');
  useEffect(() => {
    const started = Date.now();
    void listHosts()
      .then((saved) => {
        setHosts(saved);
        if (saved.length === 1) setScreen({ kind: 'host', host: saved[0] });
      })
      .catch((cause) => {
        setHosts([]);
        setError(String(cause));
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
      .then(() => setHosts((current) => current?.filter((item) => item.id !== host.id) ?? []))
      .catch((cause) => setError(String(cause)));
  let view = null;
  if (hosts) {
    if (screen.kind === 'host') {
      view = (
        <HostWork
          key={screen.host.id}
          host={screen.host}
          onHosts={() => setScreen({ kind: 'hosts' })}
        />
      );
    } else if (screen.kind === 'pair' || !hosts.length) {
      view = (
        <Pairing
          onBack={hosts.length ? () => setScreen({ kind: 'hosts' }) : undefined}
          onPaired={(host) => {
            setHosts((current) => [
              ...(current ?? []).filter((item) => item.origin !== host.origin),
              host,
            ]);
            setScreen({ kind: 'host', host });
          }}
        />
      );
    } else {
      view = (
        <Hosts
          hosts={hosts}
          onOpen={(host) => setScreen({ kind: 'host', host })}
          onPair={() => setScreen({ kind: 'pair' })}
          onRemove={remove}
        />
      );
    }
  }
  return (
    <>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
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
