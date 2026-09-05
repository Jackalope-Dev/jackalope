import { RefreshCw } from 'lucide-react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';

export function RunnerConnections() {
  const { runners, discovering, discover, error } = useExecutionStore();
  return (
    <section className="task-page max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-5 mb-10">
        <div>
          <p className="task-eyebrow">Your tools, connected</p>
          <h1 className="task-title">Agents</h1>
          <p className="task-muted mt-3">
            Use the agents already on this machine, with their existing sign-ins.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void discover()}
          disabled={discovering || !isTauriEnvironment()}
        >
          <RefreshCw size={14} />
          {discovering ? 'Checking…' : 'Refresh'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {!isTauriEnvironment() && (
        <p className="task-notice">
          Open Jackalope on your desktop to discover installed agents. No accounts are simulated
          here.
        </p>
      )}
      {runners.map((runner) => (
        <article key={runner.id} className="runner-row">
          <div className="flex justify-between gap-5">
            <h2 className="font-medium">{runner.name}</h2>
            <span className="task-status">
              {runner.signedIn ? 'Signed in' : runner.available ? 'Installed' : 'Not found'}
            </span>
          </div>
          <p className="task-muted mt-2">{runner.signedIn ? runner.account : runner.detail}</p>
          {runner.signedIn && <p className="task-muted text-xs mt-3">{runner.detail}</p>}
        </article>
      ))}
      <p className="task-muted mt-8 text-xs leading-relaxed">
        Start work from Tasks. Each attempt records its runner and reported model. Sign-in belongs
        to the CLI; Jackalope does not copy your credentials. Switching between multiple accounts
        and remaining subscription quotas are not yet supported.
      </p>
    </section>
  );
}
