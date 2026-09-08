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
        <section className="mx-auto max-w-xl space-y-6 py-8" aria-labelledby="access-heading">
          <h1 id="access-heading" className="text-2xl font-semibold">
            Welcome to Jackalope early access
          </h1>
          <p>
            Sign in with the email approved from the waitlist to start working with your agents.
          </p>
          {!access && !error ? <p role="status">Checking access…</p> : <JackalopeAccount />}
          {error && (
            <p role="alert">
              Access could not be checked. Retry the account connection or open your saved work.
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setReviewing(true);
              setConnecting(false);
            }}
          >
            Open saved work
          </Button>
          <p className="settings-row-description">
            Already approved? Use the same email you used on the website. New work requires
            approval; your existing files stay on this computer.
          </p>
        </section>
      </main>
    </div>
  );
}
