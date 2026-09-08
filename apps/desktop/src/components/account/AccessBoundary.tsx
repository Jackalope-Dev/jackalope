import { EchoMark } from '@jackalope/brand/echo';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { JackalopeAccount } from '../settings/JackalopeAccount';
import { Button } from '../ui/button';
import './access.css';

interface AccessStatus {
  required: boolean;
  allowed: boolean;
  validUntil: number | null;
}

export function AccessBoundary({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [error, setError] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const entered = useRef(false);
  useEffect(() => {
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = isTauriEnvironment()
          ? await nativeTask<AccessStatus>('app_execution_access')
          : { required: false, allowed: true, validUntil: null };
        if (!canceled) {
          setAccess(value);
          setError(false);
          if (value.allowed) setConnecting(false);
        }
      } catch {
        if (!canceled) {
          setAccess(null);
          setError(true);
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
  if (access?.allowed) entered.current = true;
  if (!connecting && (access?.allowed || reviewing || entered.current)) {
    return (
      <div className="access-frame">
        {!access?.allowed && (
          <div className="access-notice">
            <p role="status">
              Connect an approved account to start new work. Saved work and running tasks remain
              available.
            </p>
            <Button variant="outline" onClick={() => setConnecting(true)}>
              Connect account
            </Button>
          </div>
        )}
        <div className="access-workspace">{children}</div>
      </div>
    );
  }
  return (
    <div className="access-frame">
      <ResizeHandles />
      <TitleBar />
      <main className="access-page">
        <div className="access-atmosphere" aria-hidden="true">
          <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none">
            <title>Decorative background</title>
            {[0, 1, 2, 3, 4, 5, 6].map((line) => (
              <path
                key={line}
                d="M-240 890C140 920 90 350 550 580S1100 140 1630 100"
                transform={`translate(0 ${line * 24})`}
              />
            ))}
          </svg>
        </div>
        <section className="access-welcome" aria-labelledby="access-heading">
          <header className="access-intro">
            <EchoMark animated={false} className="access-mark" />
            <h1 id="access-heading">Welcome to Jackalope.</h1>
            <p>Sign in with your approved email to get started.</p>
          </header>
          <div className="access-connection">
            {!access && !error ? (
              <p className="access-checking" role="status">
                Checking access…
              </p>
            ) : (
              <JackalopeAccount presentation="welcome" />
            )}
            {error && (
              <p className="access-error" role="alert">
                We couldn’t check your access. Retry or open your saved work.
              </p>
            )}
          </div>
          <footer className="access-footer">
            <Button
              variant="ghost"
              onClick={() => {
                setReviewing(true);
                setConnecting(false);
              }}
            >
              <FolderOpen size={16} aria-hidden="true" />
              Open saved work
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          </footer>
        </section>
        <p className="access-caption">Jackalope · Early access</p>
      </main>
    </div>
  );
}
