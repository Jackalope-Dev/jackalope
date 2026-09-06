import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  CircleDashed,
  Eye,
  FileCheck2,
  Loader2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { ScreenshotArtifact, ValidationStep } from '../../lib/task-runtime';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useDialogFocus } from '../ui/useDialogFocus';
import { ScreenshotPreview } from './ScreenshotPreview';

interface ValidationJourneyProps {
  runId: string;
  steps: ValidationStep[];
  screenshots?: ScreenshotArtifact[];
}

export function ValidationJourney({ runId, steps, screenshots = [] }: ValidationJourneyProps) {
  const [activeImage, setActiveImage] = useState<ScreenshotArtifact | null>(null);
  const [imageAttempt, setImageAttempt] = useState(0);
  const dialogFocus = useDialogFocus();

  if (steps.length === 0 && screenshots.length === 0) {
    return null;
  }

  const passedCount = steps.filter((s) => s.status === 'passed').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const totalCount = steps.length;
  const isComplete = totalCount > 0 && passedCount === totalCount;

  return (
    <div className="task-review rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
      {/* Header with summary stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)] flex items-center justify-center">
            <FileCheck2 size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Checks & screenshots
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Results and evidence recorded by the agent
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {totalCount > 0 && (
            <Badge
              variant={isComplete ? 'default' : failedCount > 0 ? 'warning' : 'outline'}
              className="text-xs px-2 py-0.5"
            >
              {passedCount}/{totalCount} Passed
            </Badge>
          )}
          {screenshots.length > 0 && (
            <Badge variant="outline" className="text-xs px-2 py-0.5 gap-1">
              <Camera size={11} />
              {screenshots.length} Screenshots
            </Badge>
          )}
        </div>
      </div>

      {/* Step by Step Timeline */}
      {steps.length > 0 && (
        <div className="space-y-2.5">
          {steps.map((step, idx) => {
            const isPassed = step.status === 'passed';
            const isFailed = step.status === 'failed';
            const isInProgress = step.status === 'in_progress';

            return (
              <div
                key={step.id || idx}
                className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)]/50 flex items-start gap-3 transition-colors"
              >
                <div className="mt-0.5 shrink-0">
                  {isPassed ? (
                    <CheckCircle2 size={16} className="text-[var(--color-success)]" />
                  ) : isFailed ? (
                    <AlertCircle size={16} className="text-[var(--color-danger)]" />
                  ) : isInProgress ? (
                    <Loader2 size={16} className="text-[var(--color-accent)] animate-spin" />
                  ) : (
                    <CircleDashed size={16} className="text-[var(--color-text-muted)]" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] break-words min-w-0">
                      {step.step}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)] shrink-0">
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="task-muted text-xs">
                    {isPassed
                      ? 'Passed'
                      : isFailed
                        ? 'Failed'
                        : isInProgress
                          ? 'In progress'
                          : 'Pending'}
                  </p>

                  {step.notes && (
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                      {step.notes}
                    </p>
                  )}

                  {step.evidence && step.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[...new Set(step.evidence)].map((item) => (
                        <span
                          key={item}
                          className="px-2 py-0.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] font-mono"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Captured Screenshot Artifacts */}
      {screenshots.length > 0 && (
        <div className="space-y-2 pt-2">
          <span className="text-xs font-semibold text-[var(--color-text-secondary)] flex items-center gap-1.5">
            <Camera size={13} />
            Screenshots
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {screenshots.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveImage(s)}
                className="group relative rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-sunken)] aspect-[16/10] text-left transition-all hover:border-[var(--color-accent)] hover:shadow-sm cursor-pointer"
              >
                <div className="w-full h-full flex items-center justify-center p-2 text-center text-[var(--color-text-muted)] bg-[var(--color-surface-elevated)]/40 group-hover:bg-[var(--color-accent-subtle)]/20">
                  <div className="space-y-1">
                    <Camera
                      size={20}
                      className="mx-auto text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)]"
                    />
                    <p className="text-xs font-mono text-[var(--color-text-primary)] truncate max-w-[120px]">
                      {s.name}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {s.width}×{s.height}
                    </p>
                  </div>
                </div>
                <div className="absolute inset-0 bg-[var(--color-surface)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex items-center justify-center text-[var(--color-text-primary)] text-sm gap-1">
                  <Eye size={13} />
                  <span>Inspect</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      <Dialog.Root
        open={!!activeImage}
        onOpenChange={(open) => {
          if (!open) setActiveImage(null);
        }}
      >
        {activeImage && (
          <Dialog.Portal>
            <Dialog.Overlay className="task-dialog-overlay" />
            <Dialog.Content
              {...dialogFocus}
              className="task-dialog appearance-panel evidence-dialog"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 break-words">
                  <Dialog.Title className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {activeImage.name}
                  </Dialog.Title>
                  <Dialog.Description className="text-xs text-[var(--color-text-muted)] font-mono break-all mt-2">
                    {activeImage.url} · {activeImage.filePath}
                  </Dialog.Description>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label="Close screenshot details"
                  onClick={() => setActiveImage(null)}
                >
                  <X size={16} />
                </Button>
              </div>

              <ScreenshotPreview
                key={`${activeImage.id}:${imageAttempt}`}
                runId={runId}
                screenshot={activeImage}
                onRetry={() => setImageAttempt((value) => value + 1)}
              />
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </Dialog.Root>
    </div>
  );
}
