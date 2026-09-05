import { useAuditStore } from '../../stores/auditStore';
import { useContextMemoryStore } from '../../stores/contextMemoryStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { assemblePrompt } from '../skills/context-assembler.ts';
import type { RunRequest, TaskRun } from '../task-runtime';
import { FALLBACK_CHAINS, getDefaultModelForRunner, getModelById } from './model-catalog.ts';
import { determineBestRoute } from './router.ts';
import type {
  AgentRunnerId,
  FailoverEvent,
  FailoverReason,
  RoutingDecision,
} from './types.ts';

export interface OrchestrateTaskOptions {
  projectId: string;
  projectName: string;
  projectPath: string;
  rawPrompt: string;
  selectedSkillIds?: string[];
  isolated?: boolean;
  forcedAgent?: AgentRunnerId | 'auto';
  forcedModel?: string;
  taskId?: string;
}

export interface OrchestrationResult {
  runId: string;
  decision: RoutingDecision;
  assembledPrompt: string;
}

class CentralOrchestrator {
  private recentFailovers: { agent: AgentRunnerId; timestamp: number }[] = [];
  private handledRuns: Set<string> = new Set();
  private failoverMap: Map<string, FailoverEvent> = new Map();

  /**
   * Dispatches a centrally orchestrated task with intelligent best-agent & best-model routing
   * and automatic codebase context injection.
   */
  async dispatch(options: OrchestrateTaskOptions): Promise<OrchestrationResult> {
    const {
      projectId,
      projectName,
      projectPath,
      rawPrompt,
      selectedSkillIds = [],
      isolated = true,
      forcedAgent,
      forcedModel,
      taskId: _taskId,
    } = options;

    const executionStore = useExecutionStore.getState();
    const settings = useSettingsStore.getState();
    const memoryStore = useContextMemoryStore.getState();

    // 1. Gather repository context memory
    const memory = memoryStore.getMemory(projectId);
    const projectRules: string[] = [];

    if (memory) {
      if (memory.conventions.length > 0) {
        projectRules.push(...memory.conventions.slice(0, 5));
      }
      if (memory.techStack.length > 0) {
        projectRules.push(`Tech Stack: ${memory.techStack.join(', ')}`);
      }
    }

    // 2. Assemble prompt transparently with skill guidelines and project conventions
    const promptResult = assemblePrompt({
      rawPrompt,
      selectedSkillIds,
      projectRules,
      executionMode: isolated ? 'isolated' : 'current',
    });

    const finalPrompt = promptResult.hasSupplementation
      ? promptResult.assembledPrompt
      : rawPrompt.trim();

    // 3. Determine best route
    const availableRunners = executionStore.runners;
    const routingDecision = determineBestRoute({
      prompt: rawPrompt,
      projectPath,
      availableRunners,
      preference: settings.routingPreference,
      recentFailovers: this.recentFailovers,
      forcedAgent: forcedAgent && forcedAgent !== 'auto' ? forcedAgent : undefined,
      forcedModel,
    });

    // 4. Record routing decision in Audit Log
    useAuditStore.getState().addEntry({
      projectId,
      projectName,
      category: 'routing',
      severity: 'info',
      title: `Routed to ${routingDecision.chosenAgent.toUpperCase()} (${routingDecision.chosenModel})`,
      message: routingDecision.explanation,
      agent: routingDecision.chosenAgent,
      model: routingDecision.chosenModel,
      details: {
        taskTitle: routingDecision.taskTitle,
        intent: routingDecision.detectedIntent,
        complexity: routingDecision.complexity,
        preference: routingDecision.preference,
        isManualOverride: routingDecision.isManualOverride,
        candidateCount: routingDecision.candidates.length,
      },
    });

    // 5. Start execution through TaskRuntime
    const request: Omit<RunRequest, 'id'> = {
      projectId,
      projectName,
      projectPath,
      agent: routingDecision.chosenAgent,
      prompt: finalPrompt,
      isolated,
    };

    const runId = await executionStore.start(request);
    this.handledRuns.add(runId);

    return {
      runId,
      decision: routingDecision,
      assembledPrompt: finalPrompt,
    };
  }

  /**
   * Scans running/completed tasks to detect quota limits, rate limits, or crashes
   * and proactively re-routes them.
   */
  async checkFailover(run: TaskRun): Promise<FailoverEvent | null> {
    const settings = useSettingsStore.getState();
    if (!settings.autoFailoverEnabled) return null;

    // Only process failed or interrupted runs that haven't been handled yet
    if (run.status !== 'failed' && run.status !== 'interrupted') return null;
    if (this.handledRuns.has(`failover:${run.id}`)) return null;

    const errorText = [
      run.error ?? '',
      ...(run.diagnostics ?? []),
      ...(run.activity ?? []),
    ]
      .join(' ')
      .toLowerCase();

    let reason: FailoverReason = 'execution_error';
    if (
      errorText.includes('quota') ||
      errorText.includes('429') ||
      errorText.includes('rate limit') ||
      errorText.includes('credit') ||
      errorText.includes('capacity') ||
      errorText.includes('insufficient')
    ) {
      reason = 'quota_exceeded';
    } else if (
      errorText.includes('unauthorized') ||
      errorText.includes('auth') ||
      errorText.includes('token expired')
    ) {
      reason = 'auth_expired';
    } else if (
      errorText.includes('crash') ||
      errorText.includes('terminated') ||
      errorText.includes('sigkill') ||
      errorText.includes('panic')
    ) {
      reason = 'process_crashed';
    }

    // Mark as handled to prevent duplicate failover loops
    this.handledRuns.add(`failover:${run.id}`);

    const failedAgent = (run.agent as AgentRunnerId) ?? 'codex';
    this.recentFailovers.push({ agent: failedAgent, timestamp: Date.now() });

    // Pick fallback candidate
    const fallbacks = FALLBACK_CHAINS[failedAgent] ?? FALLBACK_CHAINS.codex;
    const executionStore = useExecutionStore.getState();
    const available = executionStore.runners;

    let targetFallback = fallbacks[0];
    for (const fb of fallbacks) {
      const runner = available.find((r) => r.id === fb.agent);
      if (runner?.available) {
        targetFallback = fb;
        break;
      }
    }

    const fallbackModel =
      getModelById(targetFallback.model) ?? getDefaultModelForRunner(targetFallback.agent);

    const failoverEvent: FailoverEvent = {
      id: crypto.randomUUID(),
      originalRunId: run.id,
      taskId: run.taskId,
      projectId: run.projectId,
      failedAgent,
      reason,
      errorSnippet: run.error?.slice(0, 160) || 'Process exited with error.',
      fallbackAgent: targetFallback.agent,
      fallbackModel: fallbackModel.id,
      status: 're_routed',
      timestamp: new Date().toISOString(),
    };

    this.failoverMap.set(run.taskId, failoverEvent);

    // Alert Mascot
    useMascotStore.getState().setMood('thinking');

    // Record in Audit Log
    useAuditStore.getState().addEntry({
      projectId: run.projectId,
      projectName: run.projectName,
      category: 'failover',
      severity: 'warning',
      title: `Auto-Failover: ${failedAgent.toUpperCase()} -> ${targetFallback.agent.toUpperCase()}`,
      message: `Detected ${reason.replace('_', ' ')} on ${failedAgent}. Proactively re-routing task to ${fallbackModel.name} with preserved context.`,
      agent: targetFallback.agent,
      model: fallbackModel.id,
      taskId: run.taskId,
      runId: run.id,
      details: {
        originalRunId: run.id,
        reason,
        errorSnippet: failoverEvent.errorSnippet,
        fallbackModel: fallbackModel.name,
      },
    });

    // Proactively launch fallback attempt
    try {
      const newRunId = await executionStore.start({
        projectId: run.projectId,
        projectName: run.projectName,
        projectPath: run.projectPath,
        agent: targetFallback.agent,
        prompt: `[Proactive Failover: Previous attempt on ${failedAgent} encountered ${reason}. Resuming objective]\n\n${run.prompt}`,
        isolated: true,
        previousRunId: run.id,
      });

      failoverEvent.reRoutedRunId = newRunId;
      failoverEvent.status = 'resolved';

      useMascotStore.getState().setMood('working');
    } catch (e) {
      failoverEvent.status = 'failed';
      useAuditStore.getState().addEntry({
        projectId: run.projectId,
        projectName: run.projectName,
        category: 'failover',
        severity: 'error',
        title: `Failover Re-route Failed`,
        message: `Unable to automatically launch ${targetFallback.agent}: ${String(e)}`,
        taskId: run.taskId,
      });
    }

    return failoverEvent;
  }

  getFailoverForTask(taskId: string): FailoverEvent | undefined {
    return this.failoverMap.get(taskId);
  }
}

export const orchestrator = new CentralOrchestrator();
