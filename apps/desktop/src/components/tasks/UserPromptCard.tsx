import { getAgentMetadata } from '../../lib/agent-catalog';
import type { PendingUserPrompt } from '../../lib/task-runtime';
import { respondToPrompt } from '../../lib/task-runtime';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { AgentQuestion } from './AgentQuestion';

export function UserPromptCard({
  runId,
  prompt,
  active,
}: {
  runId: string;
  prompt: PendingUserPrompt;
  active: boolean;
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
    ? [run.model ?? 'CLI default model', run.accountBinding?.label || run.account]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const answer = async (value: string) => {
    const delivered = await respondToPrompt(runId, prompt.id, value);
    if (!delivered)
      throw new Error(
        'This request is no longer waiting for a response. Refresh the task to see its current state.',
      );
    useMascotStore.getState().setMood('working');
    useMascotStore.getState().say('Your response is saved for the agent.', 3000);
    await useExecutionStore.getState().refresh();
  };
  return (
    <AgentQuestion
      key={`${runId}:${prompt.id}`}
      prompt={prompt}
      active={active}
      agentName={agentName}
      agentDetail={agentDetail}
      onAnswer={answer}
    />
  );
}
