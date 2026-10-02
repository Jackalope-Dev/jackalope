import { Badge, Popover, Tabs } from '@jackalope/ui';
import { Check, ChevronDown, GitCompareArrows, Sparkles } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentModels } from '../../lib/agent-models';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { MAX_COMPARED_AGENTS } from '../../stores/compareStore';
import { useExecutionStore } from '../../stores/executionStore';
import { agentAccountFor, isAgentAllowedForProject, type Project } from '../../stores/projectStore';
import { ProviderMark } from '../agents/ProviderMark';
import { Button } from '../ui/button';
import { LoadingState } from '../ui/LoadingState';
import { Tooltip } from '../ui/Tooltip';

/** A model chosen for one agent; the name keeps the label readable without a catalog read. */
export interface ComposerModel {
  id: string;
  name: string;
}

/** Agents this project can run right now, in discovery order. */
export function useComposerAgents(project: Project | undefined) {
  return useRosterAgents(project).filter((agent) => !agent.unavailable);
}

/** Every discovered agent, with the reason the unusable ones cannot run here. */
function useRosterAgents(project: Project | undefined) {
  const runners = useExecutionStore((state) => state.runners);
  const config = useAgentConfigStore(
    useShallow((state) => ({
      isAgentEnabled: state.isAgentEnabled,
      customAgents: state.customAgents,
    })),
  );
  return runners.map((runner) => ({
    ...runner,
    adapter: config.customAgents.find((agent) => agent.id === runner.id)?.adapter ?? runner.id,
    unavailable: !runner.available
      ? runner.detail || 'Not installed or not signed in.'
      : !config.isAgentEnabled(runner.id)
        ? 'Turned off in Agents.'
        : !isAgentAllowedForProject(project, runner.id)
          ? 'Not allowed in this project.'
          : '',
  }));
}

type RosterAgent = ReturnType<typeof useRosterAgents>[number];

/**
 * Chooses who handles a new message: Automatic (empty selection), one agent and
 * optionally one of its models, or several agents that each receive the same
 * prompt in their own isolated task. A rail lists every agent; unusable ones
 * stay visible with their reason.
 */
export function ComposerAgentPicker({
  project,
  value,
  onChange,
  model,
  onModelChange,
  disabled,
  allowCompare = true,
}: {
  project: Project;
  value: string[];
  onChange: (agents: string[]) => void;
  /** Applies only when exactly one agent is chosen. */
  model?: ComposerModel | null;
  onModelChange?: (model: ComposerModel | null) => void;
  disabled?: boolean;
  allowCompare?: boolean;
}) {
  const roster = useRosterAgents(project);
  const agents = roster.filter((agent) => !agent.unavailable);
  const selected = value.filter((id) => agents.some((agent) => agent.id === id));
  const comparing = selected.length > 1;
  const single = selected.length === 1 ? agents.find((agent) => agent.id === selected[0]) : null;
  const current = comparing ? 'compare' : (single?.id ?? 'auto');
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(current);
  const modelLabel = single && model ? ` · ${model.name}` : '';
  const label = comparing
    ? `Compare ${selected.length} agents`
    : single
      ? `${single.name}${modelLabel}`
      : 'Automatic';
  const choose = (agents: string[], next: ComposerModel | null = null) => {
    onChange(agents);
    onModelChange?.(next);
    setOpen(false);
  };
  const toggleCompared = (id: string, checked: boolean) => {
    const base = comparing ? selected : single ? [single.id] : [];
    const next = checked ? [...new Set([...base, id])] : base.filter((item) => item !== id);
    onChange(next.slice(0, MAX_COMPARED_AGENTS));
    onModelChange?.(null);
  };
  const railAgent = roster.find((agent) => agent.id === rail);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setRail(current);
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          className="composer-agent-trigger"
          aria-label={`Agent: ${label}`}
        >
          {comparing ? (
            <span className="provider-mark-row" aria-hidden="true">
              {selected.slice(0, 3).map((id) => (
                <ProviderMark
                  key={id}
                  provider={agents.find((agent) => agent.id === id)?.adapter ?? id}
                  size={16}
                />
              ))}
            </span>
          ) : single ? (
            <ProviderMark provider={single.adapter} size={16} />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          <span>{label}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="agent-picker" align="end" sideOffset={8}>
          <Tabs.Root
            className="agent-picker-body"
            orientation="vertical"
            value={rail}
            onValueChange={setRail}
          >
            <Tabs.List className="agent-picker-rail" aria-label="Agents">
              <RailItem value="auto" label="Automatic" selected={current === 'auto'}>
                <Sparkles size={18} aria-hidden="true" />
              </RailItem>
              {roster.map((agent) => (
                <RailItem
                  key={agent.id}
                  value={agent.id}
                  label={agent.unavailable ? `${agent.name} (unavailable)` : agent.name}
                  selected={current === agent.id}
                  unavailable={!!agent.unavailable}
                >
                  <ProviderMark provider={agent.adapter} size={20} />
                </RailItem>
              ))}
              {allowCompare && agents.length > 1 && (
                <RailItem value="compare" label="Compare agents" selected={comparing}>
                  <GitCompareArrows size={18} aria-hidden="true" />
                </RailItem>
              )}
            </Tabs.List>
            <Tabs.Content value="auto" className="agent-picker-pane">
              <PaneHeading title="Automatic" detail="Jackalope picks an agent and account" />
              <OptionButton selected={current === 'auto'} onSelect={() => choose([])}>
                <strong>Use Automatic</strong>
                <small>Routes each message by your project’s Decisions setting.</small>
              </OptionButton>
            </Tabs.Content>
            {roster.map((agent) => (
              <Tabs.Content key={agent.id} value={agent.id} className="agent-picker-pane">
                {rail === agent.id && (
                  <AgentModelsPane
                    agent={agent}
                    project={project}
                    selected={single?.id === agent.id}
                    model={single?.id === agent.id ? (model ?? null) : null}
                    onChoose={(next) => choose([agent.id], next)}
                  />
                )}
              </Tabs.Content>
            ))}
            <Tabs.Content value="compare" className="agent-picker-pane">
              <PaneHeading
                title="Compare agents"
                detail={`Send one prompt to up to ${MAX_COMPARED_AGENTS} agents`}
              />
              {agents.map((agent) => {
                const checked = selected.includes(agent.id) && (comparing || !!single);
                return (
                  <label key={agent.id} className="agent-picker-option agent-picker-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && selected.length >= MAX_COMPARED_AGENTS}
                      onChange={(event) => toggleCompared(agent.id, event.target.checked)}
                    />
                    <ProviderMark provider={agent.adapter} size={18} />
                    <span className="agent-picker-copy">
                      <strong>{agent.name}</strong>
                    </span>
                  </label>
                );
              })}
              <p className="agent-picker-hint">
                Each works in its own copy of the project; compare the results and keep the best
                one.
              </p>
            </Tabs.Content>
          </Tabs.Root>
          {railAgent?.unavailable && <p className="agent-picker-footer">{railAgent.unavailable}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RailItem({
  value,
  label,
  selected,
  unavailable,
  children,
}: {
  value: string;
  label: string;
  selected: boolean;
  unavailable?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="left">
      <Tabs.Trigger
        value={value}
        aria-label={label}
        className="agent-picker-rail-item"
        data-current={selected || undefined}
        data-unavailable={unavailable || undefined}
      >
        {children}
      </Tabs.Trigger>
    </Tooltip>
  );
}

function PaneHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="agent-picker-heading">
      <strong>{title}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function OptionButton({
  selected,
  disabled,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="agent-picker-option"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="agent-picker-copy">{children}</span>
      <span className="agent-picker-indicator" aria-hidden="true">
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  );
}

function AgentModelsPane({
  agent,
  project,
  selected,
  model,
  onChoose,
}: {
  agent: RosterAgent;
  project: Project;
  selected: boolean;
  model: ComposerModel | null;
  onChoose: (model: ComposerModel | null) => void;
}) {
  const options = useAgentConfigStore((state) => state.runnerOptions[agent.id]);
  const isModelAllowed = useAgentConfigStore((state) => state.isModelAllowed);
  const account = agentAccountFor(project, agent.adapter);
  const { catalog, loading, error } = useAgentModels(agent.unavailable ? '' : agent.id, 0, account);
  // Respect the same restrictions the native policy enforces at launch.
  const models = (catalog?.models ?? []).filter(
    (item) =>
      isModelAllowed(item.id) && (!options?.restrictModels || options.models.includes(item.id)),
  );
  const configuredDefault = options?.defaultModel;
  const defaultId = configuredDefault || models.find((item) => item.isDefault)?.id;
  const defaultName = models.find((item) => item.id === defaultId)?.name ?? defaultId;
  return (
    <>
      <PaneHeading
        title={agent.name}
        detail={
          agent.unavailable
            ? 'Unavailable'
            : agent.account && !/\s/.test(agent.account)
              ? agent.account
              : undefined
        }
      />
      {agent.unavailable ? (
        <p className="agent-picker-hint">{agent.unavailable}</p>
      ) : (
        <>
          <OptionButton selected={selected && !model} onSelect={() => onChoose(null)}>
            <strong>Default model</strong>
            <small>{defaultName ? defaultName : 'Uses this agent’s own default'}</small>
          </OptionButton>
          {loading && <LoadingState compact label="Reading models…" />}
          {error && !loading && (
            <p className="agent-picker-hint">
              Models could not be read. The default model is still available.
            </p>
          )}
          {models.map((item) => (
            <OptionButton
              key={item.id}
              selected={selected && model?.id === item.id}
              onSelect={() => onChoose({ id: item.id, name: item.name })}
            >
              <strong>
                {item.name}
                {item.id === defaultId && (
                  <Badge appearance="plain" className="agent-picker-default">
                    default
                  </Badge>
                )}
              </strong>
              {item.name !== item.id && <small>{item.id}</small>}
            </OptionButton>
          ))}
        </>
      )}
    </>
  );
}
