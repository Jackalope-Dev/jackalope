import { isActive, type TaskRun } from './task-runtime.ts';

export async function waitForStoppedAttempt(
  id: string,
  read: () => Promise<TaskRun | undefined>,
  wait: () => Promise<void>,
  attempts = 120,
): Promise<TaskRun> {
  for (let i = 0; i < attempts; i++) {
    const run = await read();
    if (!run || run.id !== id)
      throw new Error('The original attempt is unavailable. Your follow-up is still saved.');
    if (run.status === 'interrupted')
      throw new Error(
        'Inspect interrupted ownership before continuing. Your follow-up is still saved.',
      );
    if (!isActive(run)) {
      if (!run.sessionId)
        throw new Error(
          'The agent did not provide a resumable session. Your follow-up is still saved.',
        );
      return run;
    }
    await wait();
  }
  throw new Error(
    'The agent is still stopping. Your follow-up is saved; send it once work has stopped.',
  );
}
