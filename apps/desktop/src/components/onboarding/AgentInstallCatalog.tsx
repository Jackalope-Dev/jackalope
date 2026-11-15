import { CopyButton, Disclosure, DisclosureSummary, InlineNotice } from '@jackalope/ui';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { builtinAgents } from '../../lib/agent-catalog';
import { ProviderMark } from '../agents/ProviderMark';
import { AgentInstall } from './AgentInstall';

/** A shell command with a copy action that reports clipboard failures. */
export function CommandCopy({ command }: { command: string }) {
  return (
    <div className="onboarding-command-box">
      <code>{command}</code>
      <CopyButton text={command} variant="outline" size="sm" />
    </div>
  );
}

/**
 * Supported agents that are not installed yet, with docs and install commands.
 * `first` means nothing is installed, so the catalog starts open as the next step.
 * With `onInstalled`, each agent can be installed in the app; the callback re-scans.
 */
export function AgentInstallCatalog({
  agents,
  first = false,
  onInstalled,
}: {
  agents: readonly (typeof builtinAgents)[number][];
  first?: boolean;
  onInstalled?: (agentId: string) => Promise<void>;
}) {
  const [installed, setInstalled] = useState<{ id: string; name: string }>();
  // Shown once the re-scan found the agent, which then leaves this list.
  const notice = installed && !agents.some((agent) => agent.id === installed.id) && (
    <InlineNotice tone="success" className="mt-3">
      {installed.name} is installed. Sign in on its card above.
    </InlineNotice>
  );
  if (!agents.length) return notice || null;
  return (
    <>
      {notice}
      <Disclosure className="onboarding-install-catalog" open={first}>
        <DisclosureSummary>
          {first
            ? 'Install a supported agent'
            : `Install other supported agents (${agents.length} available)`}
        </DisclosureSummary>
        <p className="onboarding-note">
          {onInstalled
            ? 'Jackalope runs the install command shown when you click Install.'
            : 'Run an install command in a terminal. Jackalope finds the agent when you return.'}
        </p>
        <div className="onboarding-catalog-grid">
          {agents.map((agent) => (
            <div key={agent.id} className="onboarding-catalog-card">
              <div className="onboarding-catalog-head">
                <div className="flex items-center gap-2.5">
                  <ProviderMark provider={agent.id} size={16} />
                  <div>
                    <strong>{agent.name}</strong>
                    <span className="onboarding-vendor">{agent.vendor}</span>
                  </div>
                </div>
                <a
                  href={agent.installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="onboarding-catalog-link"
                  aria-label={`Open ${agent.name} docs`}
                  title={`Open ${agent.name} docs`}
                >
                  <ExternalLink size={14} />
                </a>
              </div>
              <p className="onboarding-catalog-desc">{agent.description}</p>
              {onInstalled ? (
                <AgentInstall
                  agentId={agent.id}
                  agentName={agent.name}
                  onInstalled={async () => {
                    setInstalled({ id: agent.id, name: agent.name });
                    await onInstalled(agent.id);
                  }}
                />
              ) : (
                agent.installCommand && <CommandCopy command={agent.installCommand} />
              )}
            </div>
          ))}
        </div>
      </Disclosure>
    </>
  );
}
