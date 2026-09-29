import { type Comparison, useCompareStore } from '../stores/compareStore';
import { useExecutionStore } from '../stores/executionStore';
import { agentAccountFor, type Project } from '../stores/projectStore';
import { useTaskStore } from '../stores/taskStore';
import type { ContextSelection } from './knowledge';
import type { RunRequest } from './task-runtime';
import { taskTitle } from './task-title';

/**
 * Starts the same prompt once per agent, each as an ordinary isolated task, and
 * groups them so their results can be compared. Tasks that already started stay
 * running if a later one fails to start; the comparison records which agents did
 * not start. Throws only when no task started.
 */
export async function startComparison({
  project,
  prompt,
  agents,
  contextSelection,
  codexSpeed,
}: {
  project: Project;
  prompt: string;
  agents: { id: string; name: string; adapter: string }[];
  contextSelection?: ContextSelection;
  codexSpeed?: RunRequest['codexSpeed'];
}): Promise<Comparison> {
  const execution = useExecutionStore.getState();
  const comparison: Comparison = {
    id: crypto.randomUUID(),
    projectId: project.id,
    prompt,
    taskIds: [],
    createdAt: new Date().toISOString(),
  };
  const failures: string[] = [];
  for (const agent of agents) {
    try {
      const runId = await execution.start(
        {
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          agent: agent.id,
          agentProfileId: agentAccountFor(project, agent.adapter),
          prompt,
          isolated: true,
          targetBranch: project.preferences?.baseBranch || project.gitBranch,
          verifyCommand: project.preferences?.verifyCommand,
          prepareCommand: project.preferences?.prepareCommand,
          setupFiles: project.preferences?.setupFiles,
          autoVerify: project.preferences?.autoVerify ?? true,
          effort: 'balanced',
          codexSpeed,
          contextSelection,
        },
        { background: true },
      );
      const run = useExecutionStore.getState().runs.find((item) => item.id === runId);
      comparison.taskIds.push(run?.taskId ?? runId);
      useTaskStore.getState().addTask({
        projectId: project.id,
        title: `${taskTitle(prompt)} · ${agent.name}`,
        status: 'backlog',
        rawPrompt: prompt,
        assignedAgent: agent.id,
        contextSelection,
        codexSpeed,
        runId,
      });
    } catch (error) {
      failures.push(`${agent.name}: ${String(error)}`);
    }
  }
  if (!comparison.taskIds.length) {
    const reasons = [
      ...new Set(failures.map((failure) => failure.slice(failure.indexOf(': ') + 2))),
    ];
    throw new Error(reasons.length === 1 ? reasons[0] : failures.join(' '));
  }
  if (failures.length) comparison.failures = failures;
  useCompareStore.getState().add(comparison);
  return comparison;
}
