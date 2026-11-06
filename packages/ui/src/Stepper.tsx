import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { LoadingIcon } from './Icon';
import { cn } from './utils';
import './stepper.css';

export type StepState = 'done' | 'running' | 'failed' | 'waiting';

export interface StepperStep {
  id: string;
  label: ReactNode;
  state: StepState;
  /** A short line under the label, such as the resource a finished step created. */
  detail?: ReactNode;
}

const SPOKEN: Record<StepState, string> = {
  done: ' (done)',
  running: ' (in progress)',
  failed: ' (failed)',
  waiting: '',
};

/** The current step of a run: the one running, else the one that failed. */
function currentStep(steps: StepperStep[]) {
  return (
    steps.find((step) => step.state === 'running') ?? steps.find((step) => step.state === 'failed')
  );
}

/**
 * Progress through a multi-step operation that runs on its own, such as deploying or
 * provisioning. The line between steps fills as each finishes, the running step pulses
 * gently and a finished step draws its check; reduced motion shows each state at once.
 * The current step carries `aria-current="step"` and every state is spoken.
 */
export function Stepper({
  steps,
  label,
  className,
}: {
  steps: StepperStep[];
  /** Names the list for assistive technology, such as "Swarm setup". */
  label: string;
  className?: string;
}) {
  const current = currentStep(steps);
  return (
    <ol className={cn('ui-stepper', className)} aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="ui-stepper-step"
          data-state={step.state}
          aria-current={step === current ? 'step' : undefined}
        >
          <span className="ui-stepper-mark" aria-hidden="true">
            {step.state === 'done' ? (
              <svg viewBox="0 0 16 16" className="ui-stepper-check" aria-hidden="true">
                <title>Done</title>
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            ) : step.state === 'failed' ? (
              <X size={14} />
            ) : step.state === 'running' ? (
              <LoadingIcon />
            ) : (
              index + 1
            )}
          </span>
          <span className="ui-stepper-text">
            <span className="ui-stepper-label">
              {step.label}
              <span className="ui-sr-only">{SPOKEN[step.state]}</span>
            </span>
            {step.detail && <span className="ui-stepper-detail">{step.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
