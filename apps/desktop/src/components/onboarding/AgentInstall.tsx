import { Button, CopyButton, InlineNotice, LinkButton } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import {
  type AgentInstallPlan,
  agentInstallPlan,
  NODE_DOWNLOAD_URL,
  plainTerminalText,
  startAgentInstall,
} from '../../lib/agent-install';
import { pollSignIn, stopSignIn } from '../../lib/agent-profiles';
import { useManagedRuntime } from '../../lib/managed-runtime';
import { openExternalUrl } from '../../lib/native/env';
import { ManagedRuntimeProgress } from '../agents/ManagedRuntimeProgress';

type Run =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string }
  | { kind: 'done' };

/** Keeps the end of a long install log. */
const LOG_LIMIT = 20_000;

/**
 * Installs one agent after the person clicks Install. Shows the exact npm command
 * before it runs, streams its output and reports success so the caller can re-scan.
 * OpenCode uses the private runner where the platform supports it.
 */
export function AgentInstall({
  agentId,
  agentName,
  onInstalled,
}: {
  agentId: string;
  agentName: string;
  onInstalled: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<AgentInstallPlan>();
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [log, setLog] = useState('');
  const runner = useManagedRuntime();
  const alive = useRef(true);
  const session = useRef<string | null>(null);
  const logView = useRef<HTMLPreElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Follows new output.
  useEffect(() => {
    logView.current?.scrollTo({ top: logView.current.scrollHeight });
  }, [log]);
  useEffect(() => {
    alive.current = true;
    void agentInstallPlan(agentId)
      .then((next) => {
        if (alive.current) setPlan(next);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      if (session.current) void stopSignIn(session.current).catch(() => {});
    };
  }, [agentId]);

  const succeed = async () => {
    if (!alive.current) return;
    setRun({ kind: 'done' });
    await onInstalled();
  };
  const fail = (message: string) => {
    if (alive.current) setRun({ kind: 'failed', message });
  };

  const installWithNpm = async () => {
    setLog('');
    setRun({ kind: 'running' });
    let id: string;
    try {
      id = await startAgentInstall(agentId);
    } catch (cause) {
      fail(String(cause));
      return;
    }
    if (!alive.current) {
      void stopSignIn(id).catch(() => {});
      return;
    }
    session.current = id;
    let cursor = 0;
    let raw = '';
    while (alive.current && session.current === id) {
      try {
        const view = await pollSignIn(id, cursor);
        for (const chunk of view.chunks) {
          raw = (raw + chunk.data).slice(-LOG_LIMIT);
          cursor = chunk.sequence;
        }
        if (alive.current) setLog(plainTerminalText(raw));
        if (view.state === 'running') {
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        session.current = null;
        void stopSignIn(id).catch(() => {});
        if (view.state === 'exited' && view.exitCode === 0) await succeed();
        else if (view.state === 'cancelled') fail('Install canceled.');
        else
          fail(
            `${agentName} did not install. Review npm's output, then retry or follow the install guide.`,
          );
        return;
      } catch (cause) {
        session.current = null;
        fail(String(cause));
        return;
      }
    }
  };

  const installRunner = async () => {
    setRun({ kind: 'running' });
    try {
      await runner.prepare(false);
      await succeed();
    } catch (cause) {
      fail(String(cause));
    }
  };

  const cancel = async () => {
    if (plan?.managed) {
      await runner.cancel().catch(() => {});
      return;
    }
    const id = session.current;
    session.current = null;
    if (id) await stopSignIn(id).catch(() => {});
    fail('Install canceled.');
  };

  if (!plan || (!plan.command && !plan.managed)) return null;
  const running = run.kind === 'running';
  const missingNode = !plan.managed && !plan.npm;
  return (
    <div className="onboarding-install-run">
      {plan.managed ? (
        <p className="onboarding-catalog-desc">
          Downloads a verified copy of OpenCode for Jackalope. Node.js is not needed.
        </p>
      ) : (
        plan.command && (
          <div className="onboarding-command-box">
            <code>{plan.command}</code>
            <CopyButton text={plan.command} variant="outline" size="sm" />
          </div>
        )
      )}
      {missingNode && (
        <InlineNotice
          tone="warning"
          action={
            <LinkButton external onClick={() => void openExternalUrl(NODE_DOWNLOAD_URL)}>
              Get Node.js
            </LinkButton>
          }
        >
          Installing {agentName} needs Node.js with npm. Install it, restart Jackalope, then try
          again.
        </InlineNotice>
      )}
      {running && plan.managed && (
        <ManagedRuntimeProgress progress={runner.progress} onCancel={() => void cancel()} />
      )}
      {!plan.managed && log && (
        <pre
          ref={logView}
          className="onboarding-install-log"
          role="log"
          aria-label={`${agentName} install`}
        >
          {log}
        </pre>
      )}
      {run.kind === 'failed' && <InlineNotice tone="error">{run.message}</InlineNotice>}
      {run.kind === 'done' ? (
        <InlineNotice tone="success">
          {agentName} is installed. If it does not appear above, restart Jackalope so it finds the
          new command.
        </InlineNotice>
      ) : running ? (
        !plan.managed && (
          <div>
            <Button size="sm" variant="outline" onClick={() => void cancel()}>
              Cancel install
            </Button>
          </div>
        )
      ) : (
        <div>
          <Button
            size="sm"
            disabled={missingNode}
            onClick={() => void (plan.managed ? installRunner() : installWithNpm())}
          >
            {run.kind === 'failed' ? 'Retry install' : `Install ${agentName}`}
          </Button>
        </div>
      )}
    </div>
  );
}
