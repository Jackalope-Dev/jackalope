import { CopyButton, Disclosure, DisclosureSummary } from '@jackalope/ui';
import { ExternalLink } from 'lucide-react';
import type { builtinAgents } from '../../lib/agent-catalog';
import { AgentAvatar } from '../agents/AgentAvatar';

/** A shell command with a copy action that reports clipboard failures. */
export function CommandCopy({ command }: { command: string }) {
  return (
    <div className="onboarding-command-box">
      <code>{command}</code>
      <CopyButton text={command} variant="outline" size="sm" />
    </div>
  );
}

/** Supported agents that are not installed yet, with docs and install commands. */
export function AgentInstallCatalog({
  agents,
}: {
  agents: readonly (typeof builtinAgents)[number][];
}) {
  if (!agents.length) return null;
  return (
    <Disclosure className="onboarding-install-catalog">
      <DisclosureSummary>
        Install other supported agents ({agents.length} available)
      </DisclosureSummary>
      <div className="onboarding-catalog-grid">
        {agents.map((agent) => (
          <div key={agent.id} className="onboarding-catalog-card">
            <div className="onboarding-catalog-head">
              <div className="flex items-center gap-2.5">
                <AgentAvatar provider={agent.id} size="xs" />
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
            {agent.installCommand && <CommandCopy command={agent.installCommand} />}
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
