import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import { managedTaskCommand } from '../../lib/managed-task';
import type { RunRequest } from '../../lib/task-runtime';
import {
  assessmentKey,
  assessTask,
  cancelAssessment,
  type TaskAssessment,
} from '../../lib/task-strategy';
import { syncAgentConfig } from '../../stores/agentConfigStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function useTaskAssessment() {
  const [assessment, setAssessment] = useState<{
    value: TaskAssessment;
    key: string;
    request: RunRequest;
  }>();
  const [busy, setBusy] = useState(false);
  const operation = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (operation.current) void cancelAssessment(operation.current);
    };
  }, []);
  const assess = async (request: RunRequest, intent: string) => {
    if (operation.current) throw new Error('A task assessment is already running.');
    const key = assessmentKey(request, intent);
    const operationId = crypto.randomUUID();
    operation.current = operationId;
    setBusy(true);
    try {
      await syncAgentConfig();
      if (!mounted.current || operation.current !== operationId)
        throw new Error('Task assessment stopped.');
      const value = await assessTask(request, intent, operationId);
      if (!mounted.current || operation.current !== operationId)
        throw new Error('Task assessment stopped.');
      setAssessment({ value, key, request });
      return value;
    } finally {
      if (operation.current === operationId) {
        operation.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  };
  const clear = () => {
    const operationId = operation.current;
    operation.current = null;
    if (mounted.current) {
      setBusy(false);
      setAssessment(undefined);
    }
    if (operationId) void cancelAssessment(operationId).catch(() => {});
  };
  const cancel = async () => clear();
  const create = async (request: RunRequest, intent: string) => {
    if (!assessment || assessment.key !== assessmentKey(request, intent))
      throw new Error('The task changed. Assess it again before creating a plan.');
    await syncAgentConfig();
    let title = intent.trim().split('\n')[0];
    while (new TextEncoder().encode(title).length > 160)
      title = Array.from(title).slice(0, -1).join('');
    const id = await managedTaskCommand<string>('create', {
      request: { ...request, id: assessment.request.id },
      assessmentId: assessment.value.id,
      title,
    });
    await useManagedTaskStore.getState().refresh();
    useManagedTaskStore.getState().select(id);
    return id;
  };
  return { assessment: assessment?.value, busy, assess, clear, cancel, create };
}

export function TaskAssessmentNotice({
  assessment,
  busy,
  onCancel,
  onSingle,
  onPlan,
}: {
  assessment?: TaskAssessment;
  busy: boolean;
  onCancel: () => void;
  onSingle: () => void;
  onPlan: () => void;
}) {
  if (busy)
    return (
      <InlineNotice>
        <span role="status">Checking the best approach…</span>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel assessment
        </Button>
      </InlineNotice>
    );
  if (!assessment || assessment.strategy === 'single') return null;
  return (
    <section className="task-assessment" aria-label="Recommended approach">
      <InlineNotice>
        <strong>
          {assessment.strategy === 'parallel'
            ? 'Consider parallel work'
            : 'Investigate before implementing'}
        </strong>
        <p>{assessment.reason}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {assessment.parallelAvailable && (
            <Button type="button" onClick={onPlan}>
              {assessment.strategy === 'parallel' ? 'Create a plan' : 'Investigate and plan'}
            </Button>
          )}
          <Button
            type="button"
            variant={assessment.strategy === 'parallel' ? 'outline' : 'primary'}
            onClick={onSingle}
          >
            {assessment.strategy === 'parallel' ? 'Continue with one lead' : 'Start with one lead'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Edit request
          </Button>
        </div>
        <Disclosure className="mt-3">
          <DisclosureSummary>Decision details</DisclosureSummary>
          <p>
            {assessment.cached ? 'Reused this assessment. ' : ''}
            {assessment.decision.provider === 'local_rules'
              ? 'Selected by local rules.'
              : `Assessed using ${assessment.decision.provider === 'jev' ? 'Jev' : 'your agent'}.`}
          </p>
          {assessment.decision.fallbackReason && <p>{assessment.decision.fallbackReason}</p>}
          {assessment.parallelAvailable && (
            <p>
              Planning uses the selected development agent. Review the assignments here before
              workers start. All work stays in one task, with one combined review.
            </p>
          )}
        </Disclosure>
      </InlineNotice>
    </section>
  );
}
