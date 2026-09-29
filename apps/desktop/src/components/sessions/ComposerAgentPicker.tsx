import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, ChevronDown, ChevronRight, Columns2, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { MAX_COMPARED_AGENTS } from '../../stores/compareStore';
import { useExecutionStore } from '../../stores/executionStore';
import { isAgentAllowedForProject, type Project } from '../../stores/projectStore';
import { AgentAvatar, AgentStack } from '../agents/AgentAvatar';
import { Button } from '../ui/button';

/** Agents this project can run right now, in discovery order. */
export function useComposerAgents(project: Project | undefined) {
  const runners = useExecutionStore((state) => state.runners);
  const config = useAgentConfigStore(
    useShallow((state) => ({
      isAgentEnabled: state.isAgentEnabled,
      customAgents: state.customAgents,
    })),
  );
  return runners
    .filter(
      (runner) =>
        runner.available &&
        config.isAgentEnabled(runner.id) &&
        isAgentAllowedForProject(project, runner.id),
    )
    .map((runner) => ({
      ...runner,
      adapter: config.customAgents.find((agent) => agent.id === runner.id)?.adapter ?? runner.id,
    }));
}

/**
 * Chooses who handles a new message: Automatic (empty selection), one agent, or
 * several agents that each receive the same prompt in their own isolated task.
 */
export function ComposerAgentPicker({
  project,
  value,
  onChange,
  disabled,
}: {
  project: Project;
  value: string[];
  onChange: (agents: string[]) => void;
  disabled?: boolean;
}) {
  const agents = useComposerAgents(project);
  const selected = value.filter((id) => agents.some((agent) => agent.id === id));
  const comparing = selected.length > 1;
  const single = selected.length === 1 ? agents.find((agent) => agent.id === selected[0]) : null;
  const label = comparing ? `Compare ${selected.length} agents` : (single?.name ?? 'Automatic');
  const toggleCompared = (id: string, checked: boolean) => {
    const base = comparing ? selected : single ? [single.id] : [];
    const next = checked ? [...new Set([...base, id])] : base.filter((item) => item !== id);
    onChange(next.slice(0, MAX_COMPARED_AGENTS));
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          className="composer-agent-trigger"
          aria-label={`Agent: ${label}`}
        >
          {comparing ? (
            <AgentStack
              agents={selected.map((id) => agents.find((agent) => agent.id === id)?.adapter ?? id)}
              size="xs"
            />
          ) : single ? (
            <AgentAvatar provider={single.adapter} size="xs" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          <span>{label}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="workspace-menu composer-agent-menu" align="start" sideOffset={8}>
          <Menu.Label className="menu-label">Run with</Menu.Label>
          <Menu.Item className="workspace-menu-item" onSelect={() => onChange([])}>
            <Sparkles size={16} aria-hidden="true" />
            <span className="composer-agent-copy">
              <strong>Automatic</strong>
              <small>Jackalope picks an agent and account</small>
            </span>
            {!selected.length && <Check size={16} aria-label="Selected" />}
          </Menu.Item>
          {agents.map((agent) => (
            <Menu.Item
              key={agent.id}
              className="workspace-menu-item"
              onSelect={() => onChange([agent.id])}
            >
              <AgentAvatar provider={agent.adapter} size="xs" />
              <span className="composer-agent-copy">
                <strong>{agent.name}</strong>
                {/* Only a concrete identity helps choose; generic sign-in notes do not. */}
                {agent.account && !/\s/.test(agent.account) && <small>{agent.account}</small>}
              </span>
              {single?.id === agent.id && <Check size={16} aria-label="Selected" />}
            </Menu.Item>
          ))}
          {agents.length > 1 && (
            <>
              <Menu.Separator className="menu-separator" />
              <Menu.Sub>
                <Menu.SubTrigger className="workspace-menu-item">
                  <Columns2 size={16} aria-hidden="true" />
                  <span className="composer-agent-copy">
                    <strong>Compare agents</strong>
                    <small>Send one prompt to several agents</small>
                  </span>
                  <ChevronRight size={14} aria-hidden="true" />
                </Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent className="workspace-menu composer-agent-menu">
                    {agents.map((agent) => {
                      const checked = selected.includes(agent.id);
                      return (
                        <Menu.CheckboxItem
                          key={agent.id}
                          className="workspace-menu-item"
                          checked={checked}
                          disabled={!checked && selected.length >= MAX_COMPARED_AGENTS}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={(next) => toggleCompared(agent.id, next === true)}
                        >
                          <span className="composer-agent-box" data-checked={checked || undefined}>
                            {checked && <Check size={12} aria-hidden="true" />}
                          </span>
                          <AgentAvatar provider={agent.adapter} size="xs" />
                          <span className="composer-agent-copy">
                            <strong>{agent.name}</strong>
                          </span>
                        </Menu.CheckboxItem>
                      );
                    })}
                    <p className="composer-agent-hint">
                      Choose up to {MAX_COMPARED_AGENTS}. Each works in its own copy of the project;
                      compare the results and keep the best one.
                    </p>
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
