import { Sparkles, Square, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  canUndoSharpen,
  sharpenDraft,
  sharpenUnavailableReason,
  stopSharpen,
} from '../../lib/sharpen';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { AgentSetupNotice, isAgentSetupError } from '../agents/AgentSetupNotice';
import { Button } from '../ui/button';
import { DismissButton } from '../ui/DismissButton';
import { InlineNotice } from '../ui/InlineNotice';
import { Tooltip } from '../ui/Tooltip';

type Sharpen = ReturnType<typeof useSharpen>;

/**
 * Sharpen for a composer: one explicit helper call that replaces the draft with
 * a deeper version of the same task, with one-step undo. It never sends.
 */
export function useSharpen({
  draft,
  apply,
  current,
  project,
  maxChars,
}: {
  draft: string;
  /** The composer's character limit; the rewrite stays within it. */
  maxChars: number;
  /** Replaces the composer's draft. */
  apply: (text: string) => void;
  /** The draft as it is now, read after the rewrite returns. */
  current: () => string;
  project?: { id: string; name: string };
}) {
  const runners = useExecutionStore((state) => state.runners);
  const customAgents = useAgentConfigStore((state) => state.customAgents);
  const isEnabled = useAgentConfigStore((state) => state.isAgentEnabled);
  const [operation, setOperation] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ original: string; rewritten: string } | null>(null);
  const [error, setError] = useState('');
  const running = useRef(false);
  const reason = sharpenUnavailableReason({
    desktop: isTauriEnvironment(),
    runners,
    adapterFor: (id) => customAgents.find((agent) => agent.id === id)?.adapter ?? id,
    isEnabled,
  });
  const sharpen = async () => {
    const original = draft;
    if (running.current || reason || !original.trim()) return;
    running.current = true;
    const id = crypto.randomUUID();
    setOperation(id);
    setError('');
    try {
      const rewritten = await sharpenDraft(original, id, { maxChars, project });
      // The draft can change elsewhere meanwhile (the terminal shares it); keep that text.
      if (current() !== original) {
        setError('The draft changed while it was being sharpened, so it was left as it is.');
        return;
      }
      apply(rewritten);
      setUndo({ original, rewritten });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/Stopped\.$/.test(message)) setError(message);
    } finally {
      running.current = false;
      setOperation(null);
    }
  };
  return {
    busy: operation !== null,
    reason,
    error,
    canUndo: canUndoSharpen(draft, undo),
    clearError: () => setError(''),
    sharpen: () => void sharpen(),
    stop: () => {
      if (operation) void stopSharpen(operation);
    },
    undo: () => {
      if (!canUndoSharpen(draft, undo)) return;
      apply(undo.original);
      setUndo(null);
    },
  };
}

/** The composer control: Sharpen, Stop while it runs, then Undo sharpen. */
export function SharpenButton({
  state,
  draft,
  disabled,
}: {
  state: Sharpen;
  draft: string;
  disabled?: boolean;
}) {
  if (state.busy)
    return (
      <Tooltip content="Sharpening the draft. Select to stop.">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Stop sharpening"
          aria-busy
          onClick={state.stop}
        >
          <Square size={16} aria-hidden="true" />
        </Button>
      </Tooltip>
    );
  if (state.canUndo)
    return (
      <Tooltip content="Bring back the draft as it was before sharpening.">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Undo sharpen"
          disabled={disabled}
          onClick={state.undo}
        >
          <Undo2 size={18} aria-hidden="true" />
        </Button>
      </Tooltip>
    );
  const unavailable = state.reason ?? (draft.trim() ? undefined : 'Write a draft to sharpen.');
  return (
    <Tooltip
      content={
        unavailable ??
        'Sharpen: rewrite this draft into a deeper version of the same task. Uses one agent call; nothing is sent.'
      }
    >
      {/* aria-disabled keeps the reason reachable by hover and keyboard focus. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={unavailable ? `Sharpen draft. ${unavailable}` : 'Sharpen draft'}
        aria-disabled={!!unavailable || disabled || undefined}
        onClick={() => {
          if (!unavailable && !disabled) state.sharpen();
        }}
      >
        <Sparkles size={18} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}

export function SharpenNotice({ state }: { state: Sharpen }) {
  if (!state.error) return null;
  return isAgentSetupError(state.error) ? (
    <AgentSetupNotice message={state.error} />
  ) : (
    <InlineNotice tone="error" action={<DismissButton onDismiss={state.clearError} />}>
      {state.error}
    </InlineNotice>
  );
}
