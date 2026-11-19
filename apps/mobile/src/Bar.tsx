import { AgentCharacter } from '@jackalope/brand/agent-character';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProviderMark } from '../../desktop/src/components/agents/ProviderMark';
import { agentProvider } from '../../desktop/src/lib/agent-provider';
import '../../desktop/src/components/agents/agent-avatar.css';

/** A screen's top bar: Back, the title with an optional second line, then its actions. */
export function Bar({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="mobile-bar mobile-glass">
      {onBack && (
        <button type="button" className="mobile-icon-button" aria-label="Back" onClick={onBack}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
      )}
      <div className="mobile-bar-title">
        <h1>{title}</h1>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {children}
    </header>
  );
}

/** The provider mark of the agent working on a task, matching the desktop sidebar. */
export function Avatar({ agent, working }: { agent?: string; working?: boolean }) {
  return (
    <span
      className="agent-avatar"
      data-size="sm"
      data-state={working ? 'working' : 'idle'}
      aria-hidden="true"
    >
      <ProviderMark provider={agentProvider(agent)} size={24} />
    </span>
  );
}

/**
 * The agent's character at card size, in the desktop's shapes: it bobs while the agent
 * works and tilts while it waits on you, only when that is true.
 */
export function Character({
  agent,
  state,
}: {
  agent?: string;
  state: 'idle' | 'working' | 'waiting';
}) {
  return (
    <span className="mobile-character" data-state={state} aria-hidden="true">
      <AgentCharacter provider={agentProvider(agent)} state={state} />
    </span>
  );
}
