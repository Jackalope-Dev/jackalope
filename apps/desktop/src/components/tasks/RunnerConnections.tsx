import { ArrowRight, Plug, RefreshCw, Sparkles } from 'lucide-react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { AgentManager } from '../agents/AgentManager';
import { Button } from '../ui/button';
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
    <section className="task-page max-w-4xl mx-auto space-y-6">
      <WorkspaceHeading
        title="Agent Command Center"
        description="Select authorized agents, restrict models, configure custom runners, and set your default meta-agent."
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

      {/* Main Agent & Model Control Center */}
      <AgentManager />

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
        <div className="flex justify-start">
          <Button onClick={onTasks}>
            Create a task
            <ArrowRight size={18} />
          </Button>
        </div>
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
