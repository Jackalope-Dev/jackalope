import { useState, useRef, useEffect } from 'react';
import { useAgentStore, AgentAccount } from '../../stores/agentStore';
import { useMascotStore } from '../../stores/mascotStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  Bot,
  Plus,
  Terminal,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';

export function AgentFleet() {
  const {
    accounts,
    activeAccountId,
    logs,
    addAccount,
    removeAccount,
    appendLog,
    clearLogs,
  } = useAgentStore();
  const { say, setMood } = useMascotStore();

  const [inputCommand, setInputCommand] = useState('');
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'system'>('all');
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccProvider, setNewAccProvider] = useState<AgentAccount['provider']>('claude-code');
  const [newAccApiKey, setNewAccApiKey] = useState('');

  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0];

  const handleSendPromptToAgent = () => {
    if (!inputCommand.trim()) return;
    setMood('working');
    say(`Dispatched instruction to ${activeAccount.accountName}...`, 3000);

    appendLog({
      processId: 4892,
      taskId: 'task-live',
      agentId: activeAccount.id,
      stream: 'system',
      message: `> ${inputCommand}`,
    });

    const cmd = inputCommand;
    setInputCommand('');

    setTimeout(() => {
      appendLog({
        processId: 4892,
        taskId: 'task-live',
        agentId: activeAccount.id,
        stream: 'stdout',
        message: `Analyzing codebase context for instruction: "${cmd}"...`,
      });
    }, 700);

    setTimeout(() => {
      appendLog({
        processId: 4892,
        taskId: 'task-live',
        agentId: activeAccount.id,
        stream: 'stdout',
        message: `Plan established: 2 files to update, 1 worktree verified clean.`,
      });
      setMood('success');
    }, 1800);
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

  const filteredLogs = logs.filter(
    (l) => streamFilter === 'all' || l.stream === streamFilter
  );

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
            Orchestrate multiple agent providers, isolate credentials, and monitor streaming process output.
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
                        <span className="text-[10px] text-[var(--color-text-secondary)] font-mono uppercase">
                          {acc.provider} • {acc.authType}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {acc.activeProcesses > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono text-[9px] border border-emerald-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {acc.activeProcesses} running
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAccount(acc.id);
                        }}
                        className="p-1 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 transition-colors cursor-pointer"
                        title="Remove account"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Token Quota Progress */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-mono">
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
              <Terminal className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              <span>
                Process Harness — <b>{activeAccount.accountName}</b> (PID 4892)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[var(--color-surface-sunken)] p-0.5 rounded-lg border border-[var(--color-border)] text-[10px]">
                {(['all', 'stdout', 'system'] as const).map((filter) => (
                  <button
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
                onClick={() => clearLogs()}
                className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors cursor-pointer"
                title="Clear terminal logs"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Terminal Screen with ANSI-like look */}
          <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-1.5 text-gray-300 select-text">
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                <span className="text-[var(--color-text-muted)] select-none shrink-0 text-[10px]">
                  [{log.timestamp}]
                </span>
                {log.stream === 'system' ? (
                  <span className="text-[var(--color-accent)] font-semibold">
                    {log.message}
                  </span>
                ) : log.stream === 'stderr' ? (
                  <span className="text-red-400">{log.message}</span>
                ) : (
                  <span className="text-gray-200">{log.message}</span>
                )}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>

          {/* Terminal Input Dispatcher */}
          <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs text-[var(--color-accent)] font-bold pl-1">
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
              <Bot className="w-5 h-5 text-[var(--color-accent)]" />
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                Connect New Agent Account
              </h3>
            </div>

            <div className="space-y-3 text-left">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Account Display Label
                </label>
                <Input
                  placeholder="e.g. Personal Claude Code / Antigravity Mesh"
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Agent Harness Provider
                </label>
                <select
                  value={newAccProvider}
                  onChange={(e) => setNewAccProvider(e.target.value as any)}
                  className="w-full h-9 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 text-xs text-[var(--color-text-primary)] focus:outline-none"
                >
                  <option value="claude-code">Claude Code (Anthropic CLI)</option>
                  <option value="antigravity">Antigravity (DeepMind Agent)</option>
                  <option value="aider">Aider (Pairing CLI)</option>
                  <option value="ollama">Ollama (Local Offline LLM)</option>
                  <option value="openhands">OpenHands (Software Agent)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  API Key or Socket Endpoint
                </label>
                <Input
                  type="password"
                  placeholder="sk-... or ws://localhost:11434"
                  value={newAccApiKey}
                  onChange={(e) => setNewAccApiKey(e.target.value)}
                  className="mt-1 text-xs font-mono"
                />
                <span className="text-[10px] text-[var(--color-text-muted)] mt-1 block">
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
