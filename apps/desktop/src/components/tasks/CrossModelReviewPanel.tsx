import {
  AlertTriangle,
  Bot,
  FileCheck2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import {
  type CrossModelReviewResult,
  getCachedReview,
  requestCrossModelReview,
} from '../../lib/cross-model-review';
import type { TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';

const REVIEWER_CANDIDATES = [
  { id: 'claude', name: 'Claude Code (Anthropic)' },
  { id: 'grok', name: 'Grok (xAI)' },
  { id: 'codex', name: 'Codex (OpenAI)' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'antigravity', name: 'Google Antigravity' },
  { id: 'gemini', name: 'Gemini CLI' },
];

export function CrossModelReviewPanel({
  run,
  files,
  diff,
}: {
  run: TaskRun;
  files: string[];
  diff: string;
}) {
  const [review, setReview] = useState<CrossModelReviewResult | undefined>(() =>
    getCachedReview(run.id),
  );
  // Default to a different agent than the author
  const defaultReviewer = REVIEWER_CANDIDATES.find((c) => c.id !== run.agent)?.id ?? 'claude';
  const [selectedReviewer, setSelectedReviewer] = useState(defaultReviewer);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startReview = async () => {
    setLoading(true);
    setError(null);
    try {
      const reviewerName =
        REVIEWER_CANDIDATES.find((c) => c.id === selectedReviewer)?.name ?? selectedReviewer;
      const res = await requestCrossModelReview({
        runId: run.id,
        authorAgent: run.agent,
        reviewerAgent: reviewerName,
        files,
        patch: diff,
      });
      setReview(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cross-model-review-panel mt-4 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileCheck2 size={17} className="text-[var(--color-brand)]" />
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Cross-Model Peer Audit & Security Review
          </h4>
        </div>
        {review && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void startReview()}
            disabled={loading}
            className="h-7 text-xs flex items-center gap-1.5"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Re-audit
          </Button>
        )}
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mt-1">
        Request an independent secondary model to audit this task’s changes for edge cases, type
        errors, and security vulnerabilities before merging.
      </p>

      {error && (
        <div className="mt-3 p-2 text-xs rounded bg-red-500/10 border border-red-500/30 text-red-400">
          {error}
        </div>
      )}

      {!review && !loading && (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)]">Reviewing agent:</span>
            <Select
              value={selectedReviewer}
              onValueChange={setSelectedReviewer}
              aria-label="Select reviewing agent"
            >
              {REVIEWER_CANDIDATES.filter((c) => c.id !== run.agent).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            onClick={() => void startReview()}
            className="text-xs flex items-center gap-1.5"
          >
            <Sparkles size={13} />
            Start Peer Review
          </Button>
        </div>
      )}

      {loading && (
        <div className="mt-3 p-4 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin text-[var(--color-brand)]" />
          <span>
            Invoking peer review with{' '}
            <strong>
              {REVIEWER_CANDIDATES.find((c) => c.id === selectedReviewer)?.name ?? selectedReviewer}
            </strong>
            … Analyzing diff and syntax tree.
          </span>
        </div>
      )}

      {review && (
        <div className="mt-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <Bot size={15} className="text-[var(--color-text-muted)]" />
              <span>
                Audited by <strong>{review.reviewerAgent}</strong>
              </span>
              <span className="text-[var(--color-text-muted)]">· Author: {review.authorAgent}</span>
            </div>

            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1.5 ${
                review.verdict === 'approved'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : review.verdict === 'warning'
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
              }`}
            >
              {review.verdict === 'approved' ? (
                <>
                  <ShieldCheck size={12} /> Approved
                </>
              ) : review.verdict === 'warning' ? (
                <>
                  <AlertTriangle size={12} /> Review Advisory
                </>
              ) : (
                <>
                  <ShieldAlert size={12} /> Changes Requested
                </>
              )}
            </span>
          </div>

          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            {review.summary}
          </p>

          {review.findings.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
              <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                Key Findings & Recommendations ({review.findings.length})
              </span>
              <ul className="space-y-1.5 mt-1">
                {review.findings.map((f) => (
                  <li
                    key={`${f.category}-${f.description}`}
                    className="text-xs p-2 rounded bg-[var(--color-bg-secondary)] flex items-start gap-2 text-[var(--color-text-primary)]"
                  >
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase mt-0.5 ${
                        f.severity === 'high'
                          ? 'bg-red-500/20 text-red-400'
                          : f.severity === 'medium'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {f.category}
                    </span>
                    <span className="flex-1 leading-snug">{f.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
