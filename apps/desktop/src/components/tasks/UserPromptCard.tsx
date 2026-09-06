import type { PendingUserPrompt } from '../../lib/task-runtime';
import { respondToPrompt } from '../../lib/task-runtime';
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
      onAnswer={answer}
    />
  );
}
