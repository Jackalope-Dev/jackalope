import { AgentCharacter } from '@jackalope/brand/agent-character';
import { FormField, Input, RefreshIcon } from '@jackalope/ui';
import {
  ArrowLeft,
  Cpu,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useAgentGaze } from '../../hooks/useAgentGaze';
import { builtinAgents } from '../../lib/agent-catalog';
import { agentProvider } from '../../lib/agent-provider';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { AgentAccounts } from './AgentAccounts';
import { AgentAvatar } from './AgentAvatar';
import { AgentInstallGuide } from './AgentInstallGuide';
import { AgentModels } from './AgentModels';
import { AgentSupport } from './AgentSupport';
import { LocalAiSetup } from './LocalAiSetup';
import './agents-workspace.css';
import './agent-manager.css';

export function AgentManager({ initialAgentId }: { initialAgentId?: string }) {
  const config = useAgentConfigStore();
  const { runners, discovering, discover } = useExecutionStore();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [modelsRevision, setModelsRevision] = useState(0);
  const refreshModels = useCallback(() => setModelsRevision((value) => value + 1), []);
  const [busy, setBusy] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(initialAgentId ?? config.defaultMetaAgent);
  const desktop = isTauriEnvironment();
  const agents = [...builtinAgents, ...config.customAgents];
  const selected = agents.find((agent) => agent.id === selectedAgent) ?? agents[0];
  const selectedRunner = runners.find((r) => r.id === selected?.id);
  const selectedEnabled = selected ? config.isAgentEnabled(selected.id) : false;
  const isDefault = !!selected && config.defaultMetaAgent === selected.id;
  const orchestrates =
    !!selected &&
    ['codex', 'claude', 'grok', 'opencode', 'kimi'].includes(
      ('adapter' in selected ? selected.adapter : undefined) ?? selected.id,
    );
  const defaultBlockedReason = !orchestrates
    ? `${selected?.name} cannot orchestrate routing. Choose Codex, Claude, Grok, OpenCode or Kimi Code.`
    : !selectedEnabled
      ? `Enable ${selected?.name} before making it the default.`
      : !selectedRunner?.available
        ? `${selected?.name} is not available on this computer yet.`
        : undefined;

  const mascotRef = useRef<HTMLDivElement>(null);
  const gaze = useAgentGaze(mascotRef);

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await syncAgentConfig();
      await discover();
      setSaved(true);
      refreshModels();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const options = selected
    ? (config.runnerOptions[selected.id] ?? {
        models: [],
        restrictModels: false,
        defaultModel: '',
      })
    : { models: [], restrictModels: false, defaultModel: '' };

  const update = (patch: Partial<typeof options>) => {
    if (!selected) return;
    config.setRunnerOptions(selected.id, { ...options, ...patch });
    setSaved(false);
  };

  return (
    <div className="agent-manager workspace-stack">
      {/* Navigation and Quick Switcher */}
      <div className="agent-manager-toolbar">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigateWorkspace('agents')}
          className="agent-manager-back"
        >
          <ArrowLeft size={16} />
          Back to agents
        </Button>

        <div className="agent-switcher-strip" role="tablist" aria-label="Select agent to configure">
          {agents.map((agent) => {
            const isCurrent = agent.id === selected?.id;
            const isAgentDef = config.defaultMetaAgent === agent.id;
            const isAgentOn = config.isAgentEnabled(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                className={`agent-switcher-tab ${isCurrent ? 'active' : ''}`}
                onClick={() => {
                  setSelectedAgent(agent.id);
                  setSaved(false);
                }}
              >
                <AgentAvatar provider={agent.id} size="xs" />
                <span className="agent-switcher-name">{agent.name}</span>
                {isAgentDef && <Star size={11} className="text-amber-500 fill-amber-500" />}
                {!isAgentOn && <span className="agent-switcher-off-dot" title="Disabled" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Hero Header: Interactive Animated Mascot + Agent Profile */}
      <div className="agent-hero-card" ref={mascotRef}>
        <div className="agent-hero-mascot" aria-hidden="true">
          <AgentCharacter provider={agentProvider(selected?.id ?? 'auto')} gaze={gaze} />
        </div>

        <div className="agent-hero-info">
          <div className="agent-hero-title-row">
            <h1 className="agent-hero-title">{selected?.name ?? 'Agent'}</h1>
          </div>

          <div className="agent-hero-badges">
            {isDefault && (
              <span className="agent-hero-badge agent-hero-badge-default">
                <Star size={12} fill="currentColor" />
                Default agent
              </span>
            )}
            <span
              className={`agent-hero-badge ${
                selectedRunner?.available
                  ? selectedRunner.signedIn
                    ? 'agent-hero-badge-ready'
                    : 'agent-hero-badge-installed'
                  : 'agent-hero-badge-unavailable'
              }`}
            >
              <span className="agent-hero-badge-dot" />
              {selectedRunner?.available
                ? selectedRunner.signedIn
                  ? 'Ready · Connected'
                  : 'Installed · CLI detected'
                : selectedRunner?.detail || 'Not installed'}
            </span>
          </div>

          <p className="agent-hero-description">
            {selected?.description ||
              (selected?.id === 'claude'
                ? 'Anthropic Claude Code assistant with deep reasoning and multi-file code editing.'
                : selected?.id === 'codex'
                  ? 'OpenAI Codex CLI runner for automated task execution and fast refactoring.'
                  : selected?.id === 'antigravity'
                    ? 'Google Antigravity agent CLI for deep planning, subagents, and self-verifying workflows.'
                    : selected?.id === 'grok'
                      ? 'xAI Grok CLI assistant with command-line reasoning capabilities.'
                      : selected?.id === 'opencode'
                        ? 'Open-source agent runner supporting both local models and hosted inference providers.'
                        : selected?.id === 'kimi'
                          ? 'Moonshot AI Kimi Code agent assistant.'
                          : 'Configured agent runner for automated project tasks.')}
          </p>
        </div>

        <div className="agent-hero-actions">
          <div className="agent-hero-toggle">
            <Switch
              checked={selectedEnabled}
              onCheckedChange={(value) => {
                if (selected) {
                  config.toggleAgent(selected.id, value);
                  setSaved(false);
                }
              }}
              label={`Enable ${selected?.name}`}
            />
            <span className="agent-hero-toggle-label">
              {selectedEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          <div className="agent-hero-buttons">
            <Button
              type="button"
              variant={isDefault ? 'secondary' : 'outline'}
              size="sm"
              disabled={
                isDefault || !selectedEnabled || !selectedRunner?.available || !orchestrates
              }
              title={isDefault ? undefined : defaultBlockedReason}
              onClick={() => {
                if (!selected) return;
                config.setDefaultMetaAgent(selected.id);
                setSaved(false);
              }}
            >
              <Star size={14} fill={isDefault ? 'currentColor' : 'none'} />
              {isDefault ? 'Default agent' : 'Make default'}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void save()}
              disabled={!desktop || busy || discovering}
              loading={busy || discovering}
              loadingLabel="Checking…"
            >
              <RefreshIcon size={16} />
              Save &amp; check agents
            </Button>

            {'isCustom' in selected && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                aria-label={`Remove ${selected.name}`}
                onClick={() => {
                  config.removeCustomAgent(selected.id);
                  setSaved(false);
                }}
              >
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {saved && (
        <InlineNotice tone="success">
          Agent settings saved. Existing runs keep their current configuration.
        </InlineNotice>
      )}
      {!config.defaultMetaAgent && (
        <InlineNotice tone="error">
          Choose an enabled default agent before starting internal agent work.
        </InlineNotice>
      )}

      {/* Special Contextual Wizards */}
      {selected?.id === 'opencode' && (
        <div className="agent-settings-card">
          <div className="agent-settings-card-header">
            <div className="agent-settings-card-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="agent-settings-card-title">Local AI &amp; Inference Setup</h2>
              <p className="agent-settings-card-description">
                Connect OpenCode with local models running in Ollama or LM Studio.
              </p>
            </div>
          </div>
          <div className="agent-settings-card-body">
            <LocalAiSetup onConnected={refreshModels} />
          </div>
        </div>
      )}

      {selected?.id === 'antigravity' && !selectedRunner?.available && (
        <div className="agent-settings-card">
          <div className="agent-settings-card-header">
            <div className="agent-settings-card-icon">
              <Terminal size={18} />
            </div>
            <div>
              <h2 className="agent-settings-card-title">CLI Installation Guide</h2>
              <p className="agent-settings-card-description">
                Install the Google Antigravity CLI to connect this agent.
              </p>
            </div>
          </div>
          <div className="agent-settings-card-body">
            <AgentInstallGuide desktopInstalled={selectedRunner?.desktopInstalled} />
          </div>
        </div>
      )}

      {/* Structured Settings Cards */}
      <div className="agent-settings-sections">
        {/* Card 1: Accounts & Credentials */}
        <section className="agent-settings-card" aria-label="Agent accounts">
          <div className="agent-settings-card-header">
            <div className="agent-settings-card-icon">
              <KeyRound size={18} />
            </div>
            <div>
              <h2 className="agent-settings-card-title">Accounts &amp; Authentication</h2>
              <p className="agent-settings-card-description">
                Manage connected accounts, API keys, and subscriptions for {selected?.name}.
              </p>
            </div>
          </div>
          <div className="agent-settings-card-body agent-config-fields">
            {selected && (
              <AgentAccounts
                key={selected.id}
                agentId={('adapter' in selected ? selected.adapter : undefined) || selected.id}
                agentName={selected.name}
                onChanged={refreshModels}
              />
            )}
          </div>
        </section>

        {/* Card 2: Models & Runtime Options */}
        <section className="agent-settings-card" aria-label="Models and executable">
          <div className="agent-settings-card-header">
            <div className="agent-settings-card-icon">
              <Cpu size={18} />
            </div>
            <div>
              <h2 className="agent-settings-card-title">Models &amp; Executable</h2>
              <p className="agent-settings-card-description">
                Select default models, restrict model choices, or customize the command path.
              </p>
            </div>
          </div>
          <div className="agent-settings-card-body agent-config-fields">
            {selected && (
              <>
                <FormField
                  label="Executable command override"
                  description="Specify a custom command name or absolute path if the agent executable is not in your default system PATH."
                >
                  <Input
                    className="task-input"
                    value={options.command ?? ('command' in selected ? selected.command : '')}
                    onChange={(e) => update({ command: e.target.value })}
                    placeholder={`Auto-detect (${('defaultBinary' in selected && selected.defaultBinary) || selected.id})`}
                  />
                </FormField>

                <AgentModels
                  key={selected.id}
                  agentId={selected.id}
                  revision={modelsRevision}
                  selected={options.models}
                  defaultModel={options.defaultModel}
                  restricted={options.restrictModels}
                  onChange={update}
                />
              </>
            )}
          </div>
        </section>

        {/* Card 3: Capabilities & Integration */}
        <section className="agent-settings-card" aria-label="Agent support">
          <div className="agent-settings-card-header">
            <div className="agent-settings-card-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="agent-settings-card-title">Capabilities &amp; Integration</h2>
              <p className="agent-settings-card-description">
                Tool protocols, context passing, and background workflows supported by{' '}
                {selected?.name}.
              </p>
            </div>
          </div>
          <div className="agent-settings-card-body">
            {selected && (
              <AgentSupport
                adapter={('adapter' in selected ? selected.adapter : undefined) ?? selected.id}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
