import { ArrowRight, Bot, Check, CircleHelp, Download, Monitor, Plug, RefreshCw, Sparkles } from 'lucide-react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function RunnerConnections({
  onTasks,
  onMcp,
}: {
  onTasks: () => void;
  onMcp?: () => void;
}) {
  const { runners, discovering, discover, error } = useExecutionStore();
  const desktop = isTauriEnvironment();
  return (
    <section className="task-page max-w-4xl mx-auto">
      <WorkspaceHeading
        title="Agents"
        description="Your installed agents, with the sign-ins you already use."
        action={
          <Button
            variant="outline"
            onClick={() => void discover()}
            disabled={discovering || !desktop}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {discovering ? 'Checking…' : 'Refresh'}
          </Button>
        }
      />
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {discovering && (
        <p role="status" className="task-notice">
          Checking installed agents…
        </p>
      )}
      {!desktop ? (
        <EmptyState
          icon={Monitor}
          title="Connect from your desktop"
          description="Open the desktop app to discover Codex, Claude Code and Grok on this machine."
        />
      ) : (
        !runners.length &&
        !discovering && (
          <EmptyState
            icon={Bot}
            title="Find your first agent"
            description="Refresh to check this machine for supported agent tools."
          />
        )
      )}
      {runners.map((runner) => {
        const StatusIcon = runner.signedIn ? Check : runner.available ? CircleHelp : Download;
        return (
          <article key={runner.id} className="runner-row">
            <span className="empty-state-icon">
              <Bot size={24} aria-hidden="true" />
            </span>
            <div className="runner-identity">
              <div className="workspace-section-heading">
                <h2>{runner.name}</h2>
                <span className="task-status">
                  <StatusIcon size={16} aria-hidden="true" />
                  {runner.signedIn
                    ? 'Signed in'
                    : runner.available
                      ? 'Check sign-in'
                      : 'Not installed'}
                </span>
              </div>
              {runner.signedIn && <p className="task-muted mt-2">{runner.account}</p>}
              {!runner.signedIn ? (
                <p className="task-muted mt-2">{runner.detail}</p>
              ) : (
                <details className="supporting-details">
                  <summary>Connection details</summary>
                  <p>{runner.detail}</p>
                </details>
              )}
            </div>
          </article>
        );
      })}
      <article className="runner-row">
        <span className="empty-state-icon">
          <Plug size={24} aria-hidden="true" />
        </span>
        <div className="runner-identity">
          <div className="workspace-section-heading">
            <h2>MCP Tools & Marketplace</h2>
            <span className="task-status">
              <Sparkles size={16} aria-hidden="true" />
              AllMCPs.com
            </span>
          </div>
          <p className="task-muted mt-2">
            Configure Model Context Protocol servers across installed agents or browse the community marketplace.
          </p>
          {onMcp && (
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={onMcp}>
                Manage MCPs & Marketplace
                <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </div>
      </article>
      {runners.some((runner) => runner.available) && (
        <Button onClick={onTasks}>
          Create a task
          <ArrowRight size={18} />
        </Button>
      )}
      <details className="supporting-details">
        <summary>Sign-ins and account access</summary>
        <p>
          Sign in through each agent’s CLI. Jackalope uses that session without copying credentials.
          Account switching is not yet available. Reported usage and supported account limits are in
          Usage.
        </p>
      </details>
    </section>
  );
}
