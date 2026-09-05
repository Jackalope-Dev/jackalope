import { Bot, Plus, RefreshCw, Send, Terminal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  getSystemInfo,
  isTauriEnvironment,
  listenPtyExit,
  listenPtyOutput,
  ptySpawn,
  ptyWrite,
} from '../../lib/tauri-bridge';
import { type AgentAccount, useAgentStore } from '../../stores/agentStore';
import { useMascotStore } from '../../stores/mascotStore';
import { useProjectStore } from '../../stores/projectStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';

export function AgentFleet() {
  const { accounts, activeAccountId, logs, addAccount, removeAccount, appendLog, clearLogs } =
    useAgentStore();
  const { say, setMood } = useMascotStore();
  const { projects, activeProjectId } = useProjectStore();

  const [inputCommand, setInputCommand] = useState('');
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'system'>('all');
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccProvider, setNewAccProvider] = useState<AgentAccount['provider']>('claude-code');
  const [newAccApiKey, setNewAccApiKey] = useState('');
  const [osName, setOsName] = useState('windows');

  const terminalEndRef = useRef<HTMLDivElement>(null);
  // accountId -> live pty session id. A ref (not state) so the event
  // listeners set up once below always see the latest mapping without
  // needing to be re-subscribed on every send.
  const accountSessionsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    getSystemInfo()
      .then((info) => setOsName(info.os))
      .catch(() => {});

    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    listenPtyOutput((payload) => {
      const agentId = Object.entries(accountSessionsRef.current).find(
        ([, sessionId]) => sessionId === payload.session_id,
      )?.[0];
      if (!agentId) return;
      const trimmed = payload.chunk.replace(/\r?\n$/, '');
      if (!trimmed) return;
      useAgentStore.getState().appendLog({
        processId: 0,
        taskId: 'live-pty',
        agentId,
        stream: 'stdout',
        message: trimmed,
      });
      // Real signal that the shell actually produced something — this is
      // the honest replacement for the old "success on write" behavior.
      useMascotStore.getState().setMood('success');
    }).then((unlisten) => {
      unlistenOutput = unlisten;
    });

    listenPtyExit((payload) => {
      const agentId = Object.entries(accountSessionsRef.current).find(
        ([, sessionId]) => sessionId === payload.session_id,
      )?.[0];
      if (agentId) delete accountSessionsRef.current[agentId];
      if (!agentId) return;
      useAgentStore.getState().appendLog({
        processId: 0,
        taskId: 'live-pty',
        agentId,
        stream: 'system',
        message: `Process session ended (${payload.session_id}).`,
      });
      useMascotStore.getState().setMood('idle');
    }).then((unlisten) => {
      unlistenExit = unlisten;
    });

    return () => {
      unlistenOutput?.();
      unlistenExit?.();
    };
    // Intentionally empty: subscribes once for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0];
  const activeProjectPath = projects.find((p) => p.id === activeProjectId)?.path;

  // NOTE (tracked as audit item F1, see docs/TODO.md): this sends raw text to
  // a plain OS shell (cmd.exe/bash) in the project directory, not to the
  // account's configured agent CLI — no adapter is detected, launched, or
  // even known to be installed. Copy and mood below are written to reflect
  // that honestly: "success" means the shell accepted the input, nothing
  // more, and mood only advances on a real signal (output/exit), never on
  // the write call alone.
  const handleSendPromptToAgent = async () => {
    if (!inputCommand.trim()) return;
    const cmd = inputCommand;
    setInputCommand('');
    setMood('working');
    say(`Running shell command in ${activeAccount.accountName}'s session...`, 3000);

    appendLog({
      processId: 0,
      taskId: 'live-pty',
      agentId: activeAccount.id,
      stream: 'system',
      message: `> ${cmd}`,
    });

    if (!isTauriEnvironment()) {
      // Browser dev-preview: no real process to talk to, so keep the UI
      // feeling alive with a short simulated response. Explicitly labeled
      // as a simulation so it can't be mistaken for a real result.
      setTimeout(() => {
        appendLog({
          processId: 0,
          taskId: 'live-pty',
          agentId: activeAccount.id,
          stream: 'stdout',
          message: `(browser preview — simulated, no real shell) received: "${cmd}"`,
        });
      }, 700);
      return;
    }

    try {
      let sessionId = accountSessionsRef.current[activeAccount.id];
      if (!sessionId) {
        const isWindows = osName === 'windows';
        sessionId = await ptySpawn({
          program: isWindows ? 'cmd.exe' : '/bin/bash',
          args: [],
          workingDir: activeProjectPath || '.',
        });
        accountSessionsRef.current[activeAccount.id] = sessionId;
      }
      // Do not claim success here: a successful write only means the shell
      // accepted the bytes, not that the command ran, succeeded, or that
      // this was ever a real agent instruction. Mood stays 'working' until
      // the pty-output/pty-exit listeners above observe an actual signal.
      await ptyWrite(sessionId, cmd + (osName === 'windows' ? '\r\n' : '\n'));
    } catch (err) {
      appendLog({
        processId: 0,
        taskId: 'live-pty',
        agentId: activeAccount.id,
        stream: 'stderr',
        message: `Failed to write to shell session: ${err}`,
      });
      setMood('idle');
    }
  };

  const handleCreateAccount = () => {
    if (!newAccName.trim()) return;
    addAccount({
      accountName: newAccName,
      provider: newAccProvider,
      authType: newAccApiKey ? 'api-key' : 'local-socket',
      apiKeyMasked: newAccApiKey ? `sk-${newAccApiKey.slice(0, 4)}••••••••` : undefined,
      avatarColor: newAccProvider === 'claude-code' ? '#f97316' : '#10b981',
      status: 'active',
      dailyQuota: 1000000,
    });
    setNewAccName('');
    setNewAccApiKey('');
    setShowAddAccountModal(false);
    say('New agent account registered to fleet harness!', 3000);
  };

  const filteredLogs = logs.filter((l) => streamFilter === 'all' || l.stream === streamFilter);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
              Agent Fleet Harness & Terminal Multiplexer
            </h2>
            <Badge variant="accent">Multi-Account Fleet</Badge>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Orchestrate multiple agent providers, isolate credentials, and monitor streaming process
            output.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setShowAddAccountModal(true)}
            className="gap-1.5 text-xs shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect Agent Account</span>
          </Button>
        </div>
      </div>

      {/* Main Split: Accounts Grid on Top / Stream on Bottom */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 overflow-hidden">
        {/* Left Column: Account Cards */}
        <div className="lg:col-span-1 flex flex-col space-y-3 overflow-y-auto pr-1">
          <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center justify-between">
            <span>Configured Agent Accounts ({accounts.length})</span>
          </div>

          <div className="space-y-2.5">
            {accounts.map((acc) => {
              const isActive = acc.id === activeAccount.id;
              const quotaPercentage =
                acc.dailyQuota === Infinity
                  ? 10
                  : Math.min(100, Math.round((acc.tokensUsedToday / acc.dailyQuota) * 100));

              return (
                <div
                  key={acc.id}
                  className={`p-3.5 rounded-xl border transition-all shadow-sm flex flex-col justify-between space-y-3 cursor-pointer ${
                    isActive
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-elevated)] ring-1 ring-[var(--color-accent)]/20'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-focus)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: acc.avatarColor }}
                      />
                      <div>
                        <div className="text-xs font-bold text-[var(--color-text-primary)]">
                          {acc.accountName}
                        </div>
                        <span className="text-xs text-[var(--color-text-secondary)] font-mono uppercase">
                          {acc.provider} • {acc.authType}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {acc.activeProcesses > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-[var(--color-success)] font-mono text-xs border border-emerald-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {acc.activeProcesses} running
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAccount(acc.id);
                        }}
                        className="p-1 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors cursor-pointer"
                        title="Remove account"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Token Quota Progress */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] font-mono">
                      <span>Daily Tokens</span>
                      <span>
                        {(acc.tokensUsedToday / 1000).toFixed(0)}k /{' '}
                        {acc.dailyQuota === Infinity
                          ? 'Unlimited'
                          : `${(acc.dailyQuota / 1000).toFixed(0)}k`}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-[var(--color-surface-sunken)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-[var(--color-accent)]"
                        style={{ width: `${quotaPercentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Live Streaming Terminal */}
        <div className="lg:col-span-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] flex flex-col overflow-hidden shadow-md">
          {/* Terminal Titlebar */}
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-mono text-xs text-[var(--color-text-primary)]">
              <Terminal className="w-3.5 h-3.5 text-[var(--color-accent-ink)]" />
              <span>
                Process Harness — <b>{activeAccount.accountName}</b> (PID 4892)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[var(--color-surface-sunken)] p-0.5 rounded-lg border border-[var(--color-border)] text-xs">
                {(['all', 'stdout', 'system'] as const).map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    onClick={() => setStreamFilter(filter)}
                    className={`px-2 py-0.5 rounded capitalize transition-all cursor-pointer ${
                      streamFilter === filter
                        ? 'bg-[var(--color-accent)] text-black font-semibold'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => clearLogs()}
                className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors cursor-pointer"
                title="Clear terminal logs"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Terminal Screen with ANSI-like look */}
          <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-1.5 text-[var(--color-text-secondary)] select-text">
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                <span className="text-[var(--color-text-muted)] select-none shrink-0 text-xs">
                  [{log.timestamp}]
                </span>
                {log.stream === 'system' ? (
                  <span className="text-[var(--color-accent-ink)] font-semibold">
                    {log.message}
                  </span>
                ) : log.stream === 'stderr' ? (
                  <span className="text-[var(--color-danger)]">{log.message}</span>
                ) : (
                  <span className="text-[var(--color-text-primary)]">{log.message}</span>
                )}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>

          {/* Terminal Input Dispatcher */}
          <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs text-[var(--color-accent-ink)] font-bold pl-1">
              &gt;
            </span>
            <input
              type="text"
              placeholder="Inject command or interactive steer prompt to agent..."
              value={inputCommand}
              onChange={(e) => setInputCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendPromptToAgent();
              }}
              className="flex-1 bg-transparent border-0 text-xs font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
            />
            <Button
              size="sm"
              onClick={handleSendPromptToAgent}
              disabled={!inputCommand.trim()}
              className="gap-1.5 text-xs h-8"
            >
              <Send className="w-3 h-3" />
              <span>Send</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-[var(--color-accent-ink)]" />
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                Connect New Agent Account
              </h3>
            </div>

            <div className="space-y-3 text-left">
              <div>
                <label
                  htmlFor="agent-account-name"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  Account Display Label
                </label>
                <Input
                  id="agent-account-name"
                  placeholder="e.g. Personal Claude Code / Antigravity Mesh"
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="agent-account-provider"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  Agent Harness Provider
                </label>
                <Select
                  id="agent-account-provider"
                  value={newAccProvider}
                  onValueChange={(value) => setNewAccProvider(value as AgentAccount['provider'])}
                  className="w-full"
                >
                  <SelectItem value="claude-code">Claude Code (Anthropic CLI)</SelectItem>
                  <SelectItem value="antigravity">Antigravity (DeepMind Agent)</SelectItem>
                  <SelectItem value="aider">Aider (Pairing CLI)</SelectItem>
                  <SelectItem value="ollama">Ollama (Local Offline LLM)</SelectItem>
                  <SelectItem value="openhands">OpenHands (Software Agent)</SelectItem>
                </Select>
              </div>

              <div>
                <label
                  htmlFor="agent-account-secret"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  API Key or Socket Endpoint
                </label>
                <Input
                  id="agent-account-secret"
                  type="password"
                  placeholder="sk-... or ws://localhost:11434"
                  value={newAccApiKey}
                  onChange={(e) => setNewAccApiKey(e.target.value)}
                  className="mt-1 text-xs font-mono"
                />
                <span className="text-xs text-[var(--color-text-muted)] mt-1 block">
                  Encrypted locally in OS keyring. Never transmitted to unapproved hosts.
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
              <Button variant="ghost" onClick={() => setShowAddAccountModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateAccount} disabled={!newAccName.trim()}>
                Save Account
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
