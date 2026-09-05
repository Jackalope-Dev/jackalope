import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Filter,
  History,
  Info,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { AuditCategory, AuditLogEntry, AuditSeverity } from '../../lib/orchestration/types';
import { useAuditStore } from '../../stores/auditStore';
import { useProjectStore } from '../../stores/projectStore';
import { button } from '../ui/button';

export function AuditLogWorkspace() {
  const { entries, clearEntries, clearProjectEntries } = useAuditStore();
  const { activeProjectId } = useProjectStore();

  const [selectedCategory, setSelectedCategory] = useState<AuditCategory | 'all'>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<AuditSeverity | 'all'>('all');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>(
    activeProjectId ?? 'all',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Project filter
      if (selectedProjectFilter !== 'all' && entry.projectId !== selectedProjectFilter) {
        return false;
      }
      // Category filter
      if (selectedCategory !== 'all' && entry.category !== selectedCategory) {
        return false;
      }
      // Severity filter
      if (selectedSeverity !== 'all' && entry.severity !== selectedSeverity) {
        return false;
      }
      // Text query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = entry.title.toLowerCase().includes(q);
        const matchesMsg = entry.message.toLowerCase().includes(q);
        const matchesAgent = entry.agent?.toLowerCase().includes(q) ?? false;
        const matchesModel = entry.model?.toLowerCase().includes(q) ?? false;
        const matchesProject = entry.projectName.toLowerCase().includes(q);
        return matchesTitle || matchesMsg || matchesAgent || matchesModel || matchesProject;
      }
      return true;
    });
  }, [entries, selectedProjectFilter, selectedCategory, selectedSeverity, searchQuery]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = entries.length;
    const routingCount = entries.filter((e) => e.category === 'routing').length;
    const failoverCount = entries.filter((e) => e.category === 'failover').length;
    const discoveryCount = entries.filter((e) => e.category === 'discovery').length;
    const successCount = entries.filter((e) => e.severity === 'success').length;
    return { total, routingCount, failoverCount, discoveryCount, successCount };
  }, [entries]);

  const getCategoryIcon = (category: AuditCategory) => {
    switch (category) {
      case 'routing':
        return <Zap size={14} className="text-amber-500" />;
      case 'failover':
        return <ShieldAlert size={14} className="text-rose-500" />;
      case 'quota':
        return <AlertTriangle size={14} className="text-amber-500" />;
      case 'discovery':
        return <Sparkles size={14} className="text-sky-500" />;
      case 'execution':
      default:
        return <Cpu size={14} className="text-emerald-500" />;
    }
  };

  const getSeverityBadge = (severity: AuditSeverity) => {
    switch (severity) {
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
            <AlertTriangle size={10} /> Error
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            <AlertTriangle size={10} /> Warning
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 size={10} /> Success
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
            <Info size={10} /> Info
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-surface)]">
      {/* Workspace Header */}
      <div className="p-6 border-b border-[var(--color-border)] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-sunken)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="p-1.5 rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
                <History size={18} />
              </span>
              <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">
                Audit Log & Orchestration History
              </h1>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              App-wide transparency into intelligent routing decisions, quota failovers, and codebase scans.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {selectedProjectFilter !== 'all' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearProjectEntries(selectedProjectFilter)}
                className="text-xs text-rose-500 hover:text-rose-600 border-rose-500/30"
              >
                <Trash2 size={13} />
                Clear this project
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={clearEntries}
                className="text-xs text-[var(--color-text-muted)] hover:text-rose-500"
              >
                <Trash2 size={13} />
                Clear all logs
              </Button>
            )}
          </div>
        </div>

        {/* Stats Pill Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Total Events
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-[var(--color-text)]">{stats.total}</span>
              <span className="text-[11px] text-[var(--color-text-muted)]">recorded</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Auto-Routed Tasks
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-amber-500">{stats.routingCount}</span>
              <span className="text-[11px] text-[var(--color-text-muted)]">optimized</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Failovers Resolved
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-rose-500">{stats.failoverCount}</span>
              <span className="text-[11px] text-[var(--color-text-muted)]">self-healed</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Codebase Scans
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-sky-500">{stats.discoveryCount}</span>
              <span className="text-[11px] text-[var(--color-text-muted)]">synced</span>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-[var(--color-border-subtle)]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Project Filter */}
            <div className="flex items-center gap-1.5 text-xs bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5">
              <Layers size={13} className="text-[var(--color-text-muted)]" />
              <select
                value={selectedProjectFilter}
                onChange={(e) => setSelectedProjectFilter(e.target.value)}
                className="bg-transparent text-xs text-[var(--color-text)] outline-none cursor-pointer"
              >
                <option value="all">All Projects</option>
                <option value="global">Global / Jackalope Workspace</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Chips */}
            <div className="flex items-center gap-1 bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-lg p-0.5">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'routing', label: 'Routing' },
                  { id: 'failover', label: 'Failovers' },
                  { id: 'execution', label: 'Executions' },
                  { id: 'discovery', label: 'Discovery' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Severity Filter */}
            <div className="flex items-center gap-1 text-xs bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5">
              <Filter size={12} className="text-[var(--color-text-muted)]" />
              <select
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value as AuditSeverity | 'all')}
                className="bg-transparent text-xs text-[var(--color-text)] outline-none cursor-pointer"
              >
                <option value="all">All Severities</option>
                <option value="info">Info only</option>
                <option value="success">Success only</option>
                <option value="warning">Warnings only</option>
                <option value="error">Errors only</option>
              </select>
            </div>
          </div>

          {/* Search Query Input */}
          <div className="relative min-w-[220px]">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              type="text"
              placeholder="Search audit events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-16">
            <History size={36} className="mx-auto text-[var(--color-text-muted)] opacity-40 mb-3" />
            <h3 className="text-sm font-medium text-[var(--color-text)]">No audit events match</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">
              {searchQuery || selectedCategory !== 'all' || selectedProjectFilter !== 'all'
                ? 'Try adjusting your filters or search query.'
                : 'Orchestration events, routing decisions, and failovers will automatically appear here.'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isExpanded = expandedIds.has(entry.id);
            const timeStr = new Date(entry.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            const dateStr = new Date(entry.timestamp).toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
            });

            return (
              <div
                key={entry.id}
                className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] hover:border-[var(--color-accent-subtle)] transition-all overflow-hidden"
              >
                {/* Header Row */}
                <div
                  onClick={() => toggleExpand(entry.id)}
                  className="p-3.5 flex items-start justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-start gap-3">
                    <span className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)] shrink-0 mt-0.5">
                      {getCategoryIcon(entry.category)}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-[var(--color-text)]">
                          {entry.title}
                        </span>
                        {getSeverityBadge(entry.severity)}
                        <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
                          {entry.projectName}
                        </span>
                        {entry.agent && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
                            <Bot size={11} />
                            {entry.agent.toUpperCase()}
                            {entry.model ? ` · ${entry.model}` : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                        {entry.message}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-right">
                    <div className="text-[11px] text-[var(--color-text-muted)]">
                      <div>{timeStr}</div>
                      <div className="text-[10px] opacity-75">{dateStr}</div>
                    </div>
                    <button
                      type="button"
                      className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded"
                    >
                      {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Details Panel */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                    <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2 flex items-center justify-between">
                      <span>Inspection & Telemetry Payload</span>
                      {entry.taskId && (
                        <span className="font-mono text-[11px]">Task ID: {entry.taskId}</span>
                      )}
                    </div>
                    {entry.details ? (
                      <pre className="p-3 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--color-border-subtle)] text-[11px] font-mono text-[var(--color-text)] overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-xs text-[var(--color-text-muted)] italic">
                        No additional telemetry captured for this event.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
