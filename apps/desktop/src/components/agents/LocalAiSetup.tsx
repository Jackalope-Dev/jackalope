import { IconButton } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Cpu, X } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { LocalInspection } from '../../lib/local-ai';
import { LoadingState } from '../ui/LoadingState';
import './local-ai.css';

const LazyLocalAiSteps = lazy(() =>
  import('./LocalAiSteps').then((m) => ({ default: m.LocalAiSteps })),
);

export function LocalAiSetup({
  onConnected,
  compact = false,
  preview,
  projectSetup = false,
}: {
  onConnected?: (profileId: string) => void | Promise<void>;
  compact?: boolean;
  preview?: LocalInspection;
  projectSetup?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`local-ai-entry ${compact ? 'local-ai-entry-compact' : ''}`}
        >
          <span className="local-ai-symbol">
            <Cpu size={23} />
          </span>
          <span>
            <strong>Try a local agent</strong>
            <small>
              No AI subscription needed. Check your computer and choose what to download.
            </small>
          </span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="local-ai-overlay" />
        <Dialog.Content className="local-ai-dialog" aria-describedby="local-ai-description">
          <header className="local-ai-header">
            <span className="local-ai-symbol">
              <Cpu size={25} />
            </span>
            <div>
              <Dialog.Title>Set up a local agent</Dialog.Title>
              <Dialog.Description id="local-ai-description">
                Your computer runs the model. Jackalope guides the setup.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton variant="ghost" label="Close local setup">
                <X size={20} />
              </IconButton>
            </Dialog.Close>
          </header>
          {open && (
            <Suspense fallback={<LoadingState label="Preparing local agent setup…" compact />}>
              <LazyLocalAiSteps
                preview={preview}
                projectSetup={projectSetup}
                onConnected={onConnected}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
