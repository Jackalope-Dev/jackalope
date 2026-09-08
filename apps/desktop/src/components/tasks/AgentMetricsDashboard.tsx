import {
  Bot,
  Clock,
  Coins,
  Gauge,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { computeAgentAnalytics } from '../../lib/agent-analytics';
import { generateAgentInsights } from '../../lib/agent-insights';
import type { TaskRun } from '../../lib/task-runtime';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { Button } from '../ui/button';

export function AgentMetricsDashboard({ runs }: { runs: TaskRun[] }) {
  const { metrics, impact } = useMemo(() => computeAgentAnalytics(runs), [runs]);
  const insights = useMemo(
    () => generateAgentInsights(runs, metrics, impact),
    [runs, metrics, impact],
  );

  const [activeCategory, setActiveCategory] = useState<'all' | 'speed' | 'cost' | 'workflow'>(
    'all',
  );

  const filteredInsights = useMemo(() => {
    if (activeCategory === 'all') return insights;
    return insights.filter((i) => i.category === activeCategory);
  }, [insights, activeCategory]);

  const topInsight = insights[0];

  return (
    <div className="agent-metrics-dashboard space-y-6">
      {/* Mascot Insights Banner */}
      <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 flex items-start gap-4 shadow-sm">
        <div className="p-2 rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)] shrink-0">
          <JackalopeMascot size="sm" overrideMood="working" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-brand)] flex items-center gap-1">
              <Sparkles size={13} />
              Jackalope Orchestration Engine
            </span>
            {topInsight && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                {topInsight.badge}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
            {topInsight?.title ?? 'Orchestration Performance Insights'}
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed max-w-2xl">
            {topInsight?.description ??
              'Jackalope continuously observes task speed, provider quotas, and model accuracy to route subtasks to the most effective local or cloud agents.'}
          </p>
        </div>
      </div>

      {/* High-Level Impact Scorecard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <span>Handoff Resilience</span>
            <ShieldCheck size={15} className="text-emerald-400" />
          </div>
          <p className="text-xl font-bold text-[var(--color-text-primary)] mt-1">
            {impact.rescuedTasksCount}{' '}
            <span className="text-xs font-normal text-[var(--color-text-muted)]">saves</span>
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
            {impact.totalHandoffs} quota handoffs executed
          </p>
        </div>

        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <span>Context Preserved</span>
            <Zap size={15} className="text-amber-400" />
          </div>
          <p className="text-xl font-bold text-[var(--color-text-primary)] mt-1">
            {Math.round(impact.estimatedTokensSaved / 1000)}k{' '}
            <span className="text-xs font-normal text-[var(--color-text-muted)]">tokens</span>
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
            Saved from rate limit aborts
          </p>
        </div>

        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <span>Hours Saved</span>
            <Clock size={15} className="text-blue-400" />
          </div>
          <p className="text-xl font-bold text-[var(--color-text-primary)] mt-1">
            ~{impact.hoursSaved}{' '}
            <span className="text-xs font-normal text-[var(--color-text-muted)]">hours</span>
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
            Automated handoff & split gains
          </p>
        </div>

        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <span>Fastest Agent</span>
            <Gauge size={15} className="text-purple-400" />
          </div>
          <p className="text-xl font-bold text-[var(--color-text-primary)] mt-1 capitalize">
            {impact.fastestAgent ?? 'Balanced'}
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Top throughput on repo</p>
        </div>
      </div>

      {/* Comparative Agent Performance */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <Bot size={16} className="text-[var(--color-brand)]" />
            Agent Efficiency & Speed Comparison
          </h4>
          <span className="text-xs text-[var(--color-text-muted)]">
            {metrics.length} active agent(s) tracked
          </span>
        </div>

        {metrics.length === 0 ? (
          <div className="p-6 text-center rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
            No agent run metrics recorded yet. Complete tasks to see real-time comparative
            analytics.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {metrics.map((m) => (
              <div
                key={m.agent}
                className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold capitalize text-[var(--color-text-primary)]">
                    {m.agent}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                    {m.tasksCount} task(s)
                  </span>
                </div>

                <p className="text-[11px] text-[var(--color-text-muted)] italic">
                  Specialty: {m.topSpecialty}
                </p>

                <div className="space-y-1 pt-2 border-t border-[var(--color-border)]/60 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text-muted)]">Avg Duration:</span>
                    <span className="font-mono text-[var(--color-text-primary)]">
                      {m.avgDurationMs > 0 ? `${Math.round(m.avgDurationMs / 1000)}s` : '—'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text-muted)]">Tokens / Task:</span>
                    <span className="font-mono text-[var(--color-text-primary)]">
                      {m.avgTokensPerTask > 0 ? m.avgTokensPerTask.toLocaleString() : '—'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text-muted)]">Success Rate:</span>
                    <span className="font-medium text-emerald-400">{m.successRate}%</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text-muted)]">Est. Cost:</span>
                    <span className="font-mono text-[var(--color-text-secondary)]">
                      ${m.estimatedCostUsd.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="w-full bg-[var(--color-bg-tertiary)] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-400 h-full rounded-full"
                    style={{ width: `${m.successRate}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Actionable Workflow Tips & Optimization Carousel */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-400" />
            Workflow Tips & Optimization Recommendations
          </h4>

          <div className="flex items-center gap-1">
            {(['all', 'speed', 'cost', 'workflow'] as const).map((cat) => (
              <Button
                key={cat}
                variant={activeCategory === cat ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setActiveCategory(cat)}
                className="h-6 text-[11px] px-2 capitalize"
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {filteredInsights.map((insight) => (
            <div
              key={insight.id}
              className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 flex items-start gap-3 transition-colors hover:bg-[var(--color-bg-secondary)]"
            >
              <div
                className={`p-1.5 rounded mt-0.5 ${
                  insight.category === 'speed'
                    ? 'bg-purple-500/10 text-purple-400'
                    : insight.category === 'cost'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : insight.category === 'resilience'
                        ? 'bg-blue-500/10 text-blue-400'
                        : 'bg-amber-500/10 text-amber-400'
                }`}
              >
                {insight.category === 'speed' && <Gauge size={14} />}
                {insight.category === 'cost' && <Coins size={14} />}
                {insight.category === 'resilience' && <ShieldCheck size={14} />}
                {insight.category === 'workflow' && <TrendingUp size={14} />}
              </div>

              <div className="flex-1 space-y-0.5">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-semibold text-[var(--color-text-primary)]">
                    {insight.title}
                  </h5>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] font-medium text-[var(--color-text-secondary)]">
                    {insight.badge}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {insight.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
