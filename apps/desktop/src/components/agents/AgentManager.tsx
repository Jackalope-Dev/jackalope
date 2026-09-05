import * as Dialog from '@radix-ui/react-dialog';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Cpu,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { getModelsForRunner } from '../../lib/orchestration/model-catalog.ts';
import type { AgentModel, AgentRunnerId } from '../../lib/orchestration/types.ts';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore.ts';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';

export function AgentManager() {
  const { runners, discovering, discover } = useExecutionStore();
  const {
    defaultMetaAgent,
    customAgents,
    toggleAgent,
    toggleModel,
    setDefaultMetaAgent,
    addCustomAgent,
    removeCustomAgent,
    isAgentEnabled,
    isModelAllowed,
  } = useAgentConfigStore();

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(
    new Set(['claude', 'codex', 'grok']),
  );
  const [addAgentOpen, setAddAgentOpen] = useState(false);

  // Form state for adding custom agent
  const [customName, setCustomName] = useState('');
  const [customId, setCustomId] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customModelNames, setCustomModelNames] = useState('');

  const desktop = isTauriEnvironment();

  const toggleExpand = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateCustomAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customId.trim() || !customCommand.trim()) return;

    const models = (customModelNames.trim() || 'default-model')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
      .map((m) => ({
        id: m.toLowerCase().replace(/\s+/g, '-'),
        name: m,
      }));

    addCustomAgent({
      id: customId.toLowerCase().replace(/\s+/g, '-'),
      name: customName.trim(),
      command: customCommand.trim(),
      description: customDescription.trim() || 'Custom user-configured agent.',
      models,
      enabled: true,
    });

    setCustomName('');
    setCustomId('');
    setCustomCommand('');
    setCustomDescription('');
    setCustomModelNames('');
    setAddAgentOpen(false);
  };

  const getCostBadge = (cost: AgentModel['relativeCost']) => {
    switch (cost) {
      case 'high':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium border border-rose-500/20">
            $$$ High
          </span>
        );
      case 'medium':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/20">
            $$ Mid
          </span>
        );
      case 'low':
      case 'free':
      default:
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-500/20">
            $ Low / Economical
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Educational Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-[var(--color-surface-elevated)] to-[var(--color-surface)] border border-[var(--color-border)] shadow-sm">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)] shrink-0 mt-0.5">
            <Sparkles size={18} />
          </span>
          <div className="flex-1 min-w-0 text-xs">
            <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">
              Centralized Agent & Model Control
            </h3>
            <p className="text-[var(--color-text-muted)] leading-relaxed">
              Jackalope gives you fine-grained authority over which agent runners are authorized, which models they may invoke, and which agent performs meta-level orchestration and codebase discovery.
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-2.5 pt-2 border-t border-[var(--color-border-subtle)]">
              <span className="inline-flex items-center gap-1.5 text-[var(--color-text)]">
                <Star size={13} className="text-amber-500 fill-amber-500" />
                <span>
                  Default Meta-Agent:{' '}
                  <strong className="text-[var(--color-accent)] uppercase font-mono">
                    {defaultMetaAgent}
                  </strong>
                </span>
              </span>
              <span className="text-[var(--color-text-muted)]">
                (handles repository context scanning & internal prompt synthesis)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Auto-detected Runners Section */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Installed Agent Runners ({runners.length})
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Discovered from your local system CLI tools.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void discover()}
              disabled={discovering || !desktop}
              className="text-xs gap-1.5"
            >
              <RefreshCw size={12} className={discovering ? 'animate-spin' : ''} />
              {discovering ? 'Checking…' : 'Re-check CLIs'}
            </Button>
            <Button
              size="sm"
              onClick={() => setAddAgentOpen(true)}
              className="text-xs gap-1.5"
            >
              <Plus size={13} />
              Add Custom Agent
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {runners.map((runner) => {
            const runnerId = runner.id as AgentRunnerId;
            const isEnabled = isAgentEnabled(runnerId);
            const isDefault = defaultMetaAgent === runnerId;
            const isExpanded = expandedAgents.has(runnerId);
            const models = getModelsForRunner(runnerId);
            const allowedCount = models.filter((m) => isModelAllowed(m.id)).length;

            return (
              <div
                key={runner.id}
                className={`rounded-xl border transition-all overflow-hidden ${
                  isEnabled
                    ? 'border-[var(--color-border)] bg-[var(--color-surface-elevated)]'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] opacity-70'
                }`}
              >
                {/* Agent Header Row */}
                <div className="p-4 flex flex-wrap items-center justify-between gap-3 select-none">
                  <div className="flex items-center gap-3">
                    <span className="p-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-[var(--color-accent)]">
                      <Bot size={20} />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--color-text)]">
                          {runner.name}
                        </h3>
                        {isDefault && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            <Star size={10} className="fill-current" />
                            Default Meta-Agent
                          </span>
                        )}
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                            runner.signedIn
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                              : runner.available
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                          }`}
                        >
                          {runner.signedIn
                            ? 'Signed In'
                            : runner.available
                              ? 'Needs Sign-in'
                              : 'Not Installed'}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {runner.account || runner.detail || 'CLI runner connection.'} ·{' '}
                        <span className="font-medium text-[var(--color-text)]">
                          {allowedCount} of {models.length} models allowed
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {!isDefault && isEnabled && (
                      <button
                        type="button"
                        onClick={() => setDefaultMetaAgent(runnerId)}
                        className="text-xs font-medium text-[var(--color-text-muted)] hover:text-amber-500 transition-colors"
                        title="Designate this agent for internal repository discovery and task orchestration"
                      >
                        Make Default Meta-Agent
                      </button>
                    )}

                    <div className="flex items-center gap-2 border-l border-[var(--color-border-subtle)] pl-3">
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) => toggleAgent(runnerId, checked)}
                        label={`Toggle ${runner.name}`}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleExpand(runnerId)}
                      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      aria-label="Toggle model restrictions"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Models Configuration Drawer */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-xs font-semibold text-[var(--color-text)]">
                        Model Allowance & Spend Limits
                      </span>
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        Restricting a model prevents Jackalope from routing to it or spending quota.
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {models.map((model) => {
                        const isAllowed = isModelAllowed(model.id);
                        return (
                          <div
                            key={model.id}
                            className={`p-3 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                              isAllowed
                                ? 'bg-[var(--color-surface-elevated)] border-[var(--color-border)]'
                                : 'bg-[var(--color-surface-sunken)] border-[var(--color-border-subtle)] opacity-60'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold text-[var(--color-text)]">
                                  {model.name}
                                </span>
                                {getCostBadge(model.relativeCost)}
                              </div>
                              <p className="text-[11px] text-[var(--color-text-muted)] line-clamp-2 leading-relaxed">
                                {model.description}
                              </p>
                              <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--color-text-muted)] font-mono">
                                <span>{(model.contextWindow / 1000).toFixed(0)}k context</span>
                                <span>·</span>
                                <span>Coding: {model.capabilities.coding}/10</span>
                                <span>·</span>
                                <span>Reasoning: {model.capabilities.reasoning}/10</span>
                              </div>
                            </div>

                            <div className="shrink-0 pt-0.5">
                              <Switch
                                checked={isAllowed}
                                disabled={!isEnabled}
                                onCheckedChange={(checked) => toggleModel(model.id, checked)}
                                label={`Allow model ${model.name}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Agents Section */}
      {customAgents.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">
            Custom Configured Agents ({customAgents.length})
          </h2>
          <div className="space-y-3">
            {customAgents.map((agent) => {
              const isEnabled = isAgentEnabled(agent.id);
              const isDefault = defaultMetaAgent === agent.id;

              return (
                <div
                  key={agent.id}
                  className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="p-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-[var(--color-accent)]">
                      <Cpu size={20} />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--color-text)]">
                          {agent.name}
                        </h3>
                        {isDefault && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30">
                            <Star size={10} className="fill-current" />
                            Default Meta-Agent
                          </span>
                        )}
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]">
                          {agent.command}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {agent.description} · Models: {agent.models.map((m) => m.name).join(', ')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {!isDefault && isEnabled && (
                      <button
                        type="button"
                        onClick={() => setDefaultMetaAgent(agent.id)}
                        className="text-xs font-medium text-[var(--color-text-muted)] hover:text-amber-500 transition-colors"
                      >
                        Make Default
                      </button>
                    )}

                    <Switch
                      checked={isEnabled}
                      onCheckedChange={(checked) => toggleAgent(agent.id, checked)}
                      label={`Toggle ${agent.name}`}
                    />

                    <button
                      type="button"
                      onClick={() => removeCustomAgent(agent.id)}
                      className="p-1.5 text-[var(--color-text-muted)] hover:text-rose-500 rounded"
                      title="Delete custom agent"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Custom Agent Modal */}
      <Dialog.Root open={addAgentOpen} onOpenChange={setAddAgentOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg p-6 rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] shadow-xl z-50 focus:outline-none">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
                  <Bot size={18} />
                </span>
                <Dialog.Title className="text-base font-semibold text-[var(--color-text)]">
                  Add Custom Agent
                </Dialog.Title>
              </div>
              <Dialog.Close className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded">
                <X size={16} />
              </Dialog.Close>
            </div>

            <Dialog.Description className="text-xs text-[var(--color-text-muted)] mb-5">
              Connect a custom CLI tool or runner that wasn't automatically discovered on this machine.
            </Dialog.Description>

            <form onSubmit={handleCreateCustomAgent} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text)] mb-1">
                  Agent Display Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Local Ollama Qwen or Aider Fast"
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    if (!customId) {
                      setCustomId(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                    }
                  }}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text)] mb-1">
                    Runner ID (Slug)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ollama-local"
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-text)] mb-1">
                    CLI Command / Path
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ollama or aider"
                    value={customCommand}
                    onChange={(e) => setCustomCommand(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-text)] mb-1">
                  Supported Models (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. qwen2.5-coder:32b, deepseek-r1:14b"
                  value={customModelNames}
                  onChange={(e) => setCustomModelNames(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-text)] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="What is this custom agent used for?"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddAgentOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Save Custom Agent
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
