import { ORCHESTRATING_AGENTS } from './agents.ts';
import { invokeNative } from './native/transport.ts';
import type { Runner } from './run-types.ts';

/** Why Sharpen cannot run now, or undefined when it can. */
export function sharpenUnavailableReason({
  desktop,
  runners,
  adapterFor,
  isEnabled,
}: {
  desktop: boolean;
  runners: Pick<Runner, 'id' | 'available'>[];
  adapterFor: (id: string) => string;
  isEnabled: (id: string) => boolean;
}): string | undefined {
  if (!desktop) return 'Sharpen needs the desktop app.';
  const ready = runners.some(
    (runner) =>
      runner.available &&
      isEnabled(runner.id) &&
      ORCHESTRATING_AGENTS.includes(adapterFor(runner.id)),
  );
  return ready
    ? undefined
    : 'Sharpen needs a signed-in Claude Code, Codex, OpenCode, Grok or Kimi Code agent.';
}

/**
 * One rewrite of a draft into a deeper version of the same task. It runs one
 * helper call that counts toward helper usage and returns text for the person
 * to edit; nothing is sent.
 */
export function sharpenDraft(
  draft: string,
  operationId: string,
  options: { maxChars: number; project?: { id: string; name: string } },
): Promise<string> {
  const { maxChars, project } = options;
  return invokeNative<string>('helper_sharpen', {
    draft,
    operationId,
    maxChars,
    projectId: project?.id,
    projectName: project?.name,
  });
}

export function stopSharpen(operationId: string): Promise<void> {
  return invokeNative<void>('helper_sharpen_cancel', { operationId });
}

/** One-step undo: available only while the draft still holds the untouched rewrite. */
export function canUndoSharpen(
  draft: string,
  undo: { original: string; rewritten: string } | null,
): undo is { original: string; rewritten: string } {
  return !!undo && draft === undo.rewritten;
}
