import { getAgentMetadata } from '../../lib/agent-catalog';
import { openInBrowser } from '../../lib/native/env';
import { planCommands } from '../../lib/plan-mode';
import type { PendingUserPrompt } from '../../lib/run-types';
import { respondToPrompt } from '../../lib/task-client';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { AgentQuestion } from './AgentQuestion';

export function UserPromptCard({
  runId,
  prompt,
  active,
  onContinue,
  accountShown = false,
}: {
  runId: string;
  prompt: PendingUserPrompt;
  active: boolean;
  /** The page already names the account, so the card names only the model. */
  accountShown?: boolean;
  /** Answers a question the attempt ended on by continuing the task with it. */
  onContinue?: (answer: string) => Promise<void>;
}) {
  const run = useExecutionStore((state) => state.runs.find((entry) => entry.id === runId));
  const customName = useAgentConfigStore(
    (state) => state.customAgents.find((agent) => agent.id === run?.agent)?.name,
  );
  // A routed attempt only names its agent once routing resolves, so fall back to
  // the generic wording rather than showing an empty or "auto" identity.
  const agentName =
    run?.agent && run.agent !== 'auto'
      ? (customName ?? getAgentMetadata(run.agent)?.name ?? run.agent)
      : undefined;
  const agentDetail = run
    ? [
        run.model ?? 'CLI default model',
        !accountShown && (run.accountBinding?.label || run.account),
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const answer = async (value: string) => {
    const delivered = await respondToPrompt(runId, prompt.id, value);
    if (!delivered)
      throw new Error(
        'This request is no longer waiting for a response. Refresh the task to see its current state.',
      );
    useMascotStore.getState().say('Your response is saved for the agent.', 3000);
    await useExecutionStore.getState().refresh();
  };
  const override = prompt.answeredBy
    ? async (value: string) => {
        await planCommands.overridePrompt(runId, prompt.id, value);
        await useExecutionStore.getState().refresh();
      }
    : undefined;
  return (
    <AgentQuestion
      key={`${runId}:${prompt.id}`}
      prompt={prompt}
      active={active}
      agentName={agentName}
      agentDetail={agentDetail}
      onAnswer={answer}
      onContinue={onContinue}
      onOverride={override}
      onOpenLink={(url) => void openInBrowser(url)}
    />
  );
}
