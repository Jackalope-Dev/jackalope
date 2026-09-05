import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  History,
  Info,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { AuditCategory, AuditSeverity } from '../../lib/orchestration/types';
import { useAuditStore } from '../../stores/auditStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';

export function AuditLogWorkspace() {
  const { entries, clearEntries, clearProjectEntries } = useAuditStore();
  const { projects, activeProjectId } = useProjectStore();

  const [selectedCategory, setSelectedCategory] = useState<AuditCategory | 'all'>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<AuditSeverity | 'all'>('all');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>(
    activeProjectId ?? 'all',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);

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
        return <Zap size={14} className="text-[var(--color-warning)]" />;
      case 'failover':
        return <ShieldAlert size={14} className="text-[var(--color-danger)]" />;
      case 'quota':
        return <AlertTriangle size={14} className="text-[var(--color-warning)]" />;
      case 'discovery':
        return <Sparkles size={14} className="text-[var(--color-accent-ink)]" />;
      case 'execution':
      default:
        return <Cpu size={14} className="text-[var(--color-success)]" />;
    }
  };

  const getSeverityBadge = (severity: AuditSeverity) => {
    switch (severity) {
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-[var(--color-danger)] dark:text-[var(--color-danger)] border border-rose-500/30">
            <AlertTriangle size={10} /> Error
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-[var(--color-warning)] border border-amber-500/30">
            <AlertTriangle size={10} /> Warning
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-[var(--color-success)] border border-emerald-500/30">
            <CheckCircle2 size={10} /> Success
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-500/15 text-[var(--color-accent-ink)] dark:text-[var(--color-accent-ink)] border border-sky-500/30">
            <Info size={10} /> Info
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface)]">
      {/* Workspace Header */}
      <div className="p-6 border-b border-[var(--color-border)] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-sunken)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="p-1.5 rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)]">
                <History size={18} />
              </span>
              <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
                Audit Log & Orchestration History
              </h1>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Recorded routing decisions, task events, and codebase scans.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                if (selectedProjectFilter === 'all') clearEntries();
                else clearProjectEntries(selectedProjectFilter);
                setConfirmClear(false);
              }}
              onBlur={() => setConfirmClear(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setConfirmClear(false);
              }}
              className={`text-xs hover:text-[var(--color-danger)] ${
                confirmClear || selectedProjectFilter !== 'all'
                  ? 'text-[var(--color-danger)]'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              <Trash2 size={13} />
              <span aria-live="polite">
                {confirmClear
                  ? 'Click again to confirm'
                  : selectedProjectFilter === 'all'
                    ? 'Clear all logs'
                    : 'Clear this project'}
              </span>
            </Button>
          </div>
        </div>

        {/* Stats Pill Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Total Events
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-[var(--color-text-primary)]">
                {stats.total}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">recorded</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Auto-Routed Tasks
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-[var(--color-warning)]">
                {stats.routingCount}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">recorded</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Failover Events
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-[var(--color-danger)]">
                {stats.failoverCount}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">recorded</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider block">
              Codebase Scans
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold text-[var(--color-accent-ink)]">
                {stats.discoveryCount}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">recorded</span>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-[var(--color-border-subtle)]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Project Filter */}
            <Select
              aria-label="Filter by project"
              value={selectedProjectFilter}
              onValueChange={(value) => {
                setConfirmClear(false);
                setSelectedProjectFilter(value);
              }}
              className="h-[50px] max-w-full"
            >
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="global">Global / Jackalope Workspace</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </Select>

            {/* Category Chips */}
            <fieldset
              aria-label="Filter by category"
              className="flex h-[50px] min-w-0 max-w-full items-center gap-1 overflow-x-auto bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-lg p-0.5"
            >
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
                  type="button"
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  aria-pressed={selectedCategory === cat.id}
                  className={`h-full shrink-0 px-2.5 py-1 rounded-md text-sm font-medium transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </fieldset>

            {/* Severity Filter */}
            <Select
              aria-label="Filter by severity"
              value={selectedSeverity}
              onValueChange={(value) => setSelectedSeverity(value as AuditSeverity | 'all')}
              className="h-[50px]"
            >
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="info">Info only</SelectItem>
              <SelectItem value="success">Success only</SelectItem>
              <SelectItem value="warning">Warnings only</SelectItem>
              <SelectItem value="error">Errors only</SelectItem>
            </Select>
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
              aria-label="Search audit events"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[50px] w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="p-6 space-y-3">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-16">
            <History size={36} className="mx-auto text-[var(--color-text-muted)] opacity-40 mb-3" />
            <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
              No audit events match
            </h3>
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
                <div className="p-3.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)] shrink-0 mt-0.5">
                      {getCategoryIcon(entry.category)}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {entry.title}
                        </span>
                        {getSeverityBadge(entry.severity)}
                        <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
                          {entry.projectName}
                        </span>
                        {entry.agent && (
                          <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)]">
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
                    <div className="text-xs text-[var(--color-text-muted)]">
                      <div>{timeStr}</div>
                      <div className="text-xs opacity-75">{dateStr}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id)}
                      aria-expanded={isExpanded}
                      aria-label={`Inspect ${entry.title}`}
                      className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] rounded"
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
                        <span className="font-mono text-xs">Task ID: {entry.taskId}</span>
                      )}
                    </div>
                    {entry.details ? (
                      <pre className="p-3 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--color-border-subtle)] text-xs font-mono text-[var(--color-text-primary)] overflow-x-auto">
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
