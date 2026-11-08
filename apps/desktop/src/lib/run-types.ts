import type { PendingUserPrompt, RunStatus } from '@jackalope/contracts/runs';
import type { DecisionReceipt } from './decisions.ts';
import type { ContextReceipt, ContextSelection } from './knowledge-types.ts';
import type { ReviewCaptures } from './review-captures.ts';
import type { TaskEffort } from './task-effort.ts';
import type { EvidenceLevel, GoalRestatement, SafetyFact, TaskContract } from './task-outcomes.ts';

/** The longest instruction the composer accepts for a task, follow-up or schedule. */
export const PROMPT_MAX_CHARS = 24_000;

export interface Runner {
  desktopInstalled?: boolean;
  id: string;
  name: string;
  available: boolean;
  signedIn: boolean;
  account: string;
  detail: string;
  /** The sign-in check ran and found no signed-in account. */
  signInNeeded?: boolean;
  /** Tasks can start: signed in, or the agent checks access when a task starts. */
  ready?: boolean;
}
export interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reported: boolean;
  estimatedCostUsd: number | null;
}
export interface TaskRun {
  archivedAt?: string | null;
  liveSessionId?: string | null;
  effort?: TaskEffort | null;
  codexSpeed?: 'standard' | 'fast' | null;
  requestedServiceTier?: string | null;
  reasoningEffort?: string | null;
  efficiency?: {
    timings?: Record<string, { calls: number; totalMs: number; maxMs: number }>;
    firstActivityMs?: number | null;
    routingCallsAvoided?: number;
    warmProviderHits?: number;
    repositoryMapCacheHits?: number;
    toolCalls?: Record<string, number>;
    toolObservationsTruncated?: boolean;
    launchPromptBytes: number;
    launches: number;
    jevQuestionCalls?: number | null;
    jevQuestions?: number | null;
    verificationCalls: number;
    verificationFailures: number;
    verificationReuses?: number | null;
    preparationReuses?: number | null;
    verificationStdoutBytes: number;
    verificationDeliveredBytes: number;
  };
  dependencyInvalidated?: boolean;
  /** The step running right now. Absent once the attempt reaches a terminal status. */
  progress?: StepProgress | null;
  /** What the project setup command did for this attempt. */
  preparation?: PreparationRecord | null;
  /** The attempt this one retried. */
  retryOf?: string | null;
  stages?: {
    stage: string;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
  }[];
  dependencySnapshot?: {
    base: string;
    sources: { runId: string; workspace: string; tree: string; head: string }[];
  };
  checkpoint?: { head: string; message: string } | null;
  checkpointError?: string | null;
  quotaFailure?: { modelOnly: boolean; message: string } | null;
  routing?: {
    attempts?: {
      agent: string;
      model: string | null;
      binding: { adapter: string; profileId: string | null; directory: string; label: string };
      usage: RunUsage;
      error: string | null;
      recordedAt: string;
    }[];
    decisions: {
      assessment?: DecisionReceipt | null;
      orchestrator: string;
      orchestratorModel: string | null;
      orchestratorAccount: string;
      agent: string;
      model: string | null;
      account: string;
      profileId: string | null;
      reason: string;
      remainingPercent: number | null;
      expectedUsagePercent: number | null;
      checkedAt: string;
      usage: RunUsage;
    }[];
    handoffs: {
      agent: string;
      model: string | null;
      binding: { adapter: string; profileId: string | null; directory: string; label: string };
      sessionId: string | null;
      result: string;
      usage: RunUsage;
      failure: { modelOnly: boolean; message: string };
      recordedAt: string;
    }[];
  } | null;
  contract?: TaskContract;
  /** The agent's own restatement of the task; absent when it never reported one. */
  understanding?: GoalRestatement | null;
  monitorChange?: { before: string; after: string; path: string; branch: string } | null;
  contextReceipt?: ContextReceipt;
  id: string;
  taskId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  workspace: string;
  branch: string;
  baseHead: string;
  agent: string;
  account: string;
  connectionIds?: string[] | null;
  targetBranch?: string | null;
  processContained?: boolean;
  verifyCommand?: string | null;
  prepareCommand?: string | null;
  setupFiles?: string[];
  autoVerify?: boolean;
  finishing?: boolean;
  verificationError?: string | null;
  verification?: Verification | null;
  /** The project computer the agent ran on, when it did not run on this device. */
  remote?: { computerId: string; computerName: string } | null;
  /** Where the capacity pool placed the attempt and why; older attempts omit it. */
  host?: {
    /** `device` or a computer's id. */
    id: string;
    name: string;
    /** Why the placer chose it. */
    reason: string;
    /** Why the host was lost during the attempt. */
    lost?: string | null;
    /** The lost host this attempt replaced. */
    retriedFrom?: string | null;
    /** What became of the attempt after its host was lost. */
    retry?: string | null;
    /** Changes the attempt left on its host when contact was lost. */
    left?: {
      /** They are still on the computer. */
      onHost: boolean;
      /** When they were fetched and saved on this device. */
      recoveredAt?: string | null;
      /** The saved patch; it is never applied to the workspace. */
      patch?: string | null;
      /** The folder of the agent's saved output. */
      artifacts?: string | null;
      files?: number;
      /** What became of them when nothing was saved. */
      note?: string | null;
    } | null;
  } | null;
  accountBinding?: {
    adapter: string;
    profileId: string | null;
    directory: string;
    label: string;
  } | null;
  model: string | null;
  prompt: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs?: number;
  sessionId: string | null;
  result: string;
  detailsOmitted?: boolean;
  activity: string[];
  diagnostics: string[];
  error: string | null;
  persistenceError: string | null;
  exitCode: number | null;
  usage: RunUsage;
  mcpUsage?: {
    searches: number;
    calls: number;
    failures: number;
    catalogTools: number;
    catalogBytes: number;
    schemaBytesReturned: number;
    resultBytesReceived?: number | null;
    resultBytesReturned?: number | null;
    resultReads?: number | null;
  };
  usageObservations?: {
    messageId: string;
    parentToolUseId: string | null;
    sessionId?: string | null;
    model: string | null;
    input: number;
    output: number;
  }[];
  prompts?: PendingUserPrompt[];
  validationSteps?: ValidationStep[];
  /** Append-only decision trail the agent reported for this attempt. */
  decisions?: DecisionEntry[];
  screenshots?: ScreenshotArtifact[];
  /** Desktop-control actions, newest last; summaries keep only the latest few. */
  desktopActions?: DesktopActionRecord[];
  /** Local preview paths the agent opened in its task browser, newest last. */
  visitedPages?: string[];
  /** Before/after screenshots Jackalope captured from the preview for review. */
  reviewCaptures?: ReviewCaptures | null;
  /** Review screenshots are still being captured after the result was recorded. */
  reviewCapturing?: boolean;
  /** The result this attempt reviews, when it is an agent or Challenge reviewer. */
  challengeOf?: {
    runId: string;
    tree: string;
    base: string;
    /** Absent on reviewers saved before agent reviews existed, which are Challenges. */
    kind?: 'challenge' | 'review';
  } | null;
}
/** @public Named in the return types of usage-entries.ts and usage-insights.ts exports. */
export interface DesktopActionRecord {
  at: string;
  action: string;
  summary: string;
  /** accessibility, pointer or keyboard for input actions. */
  method?: string | null;
  focusChanged?: boolean;
  site?: string | null;
  capture?: ScreenshotArtifact | null;
}
export interface StepProgress {
  /** Stable key: `workspace`, `dependencies`, `routing`, `agent` or `verification`. */
  step: string;
  label: string;
  /** Newest concrete signal from the step, usually the command's latest output line. */
  detail: string;
  startedAt: string;
  /** 1 on the first try; higher while an automatic retry runs. */
  attempt: number;
}
export interface PreparationRecord {
  command: string;
  skipped: boolean;
  reason: string | null;
  attempts: number;
  durationMs: number;
  exitCode: number | null;
  success: boolean;
  outputTail: string;
  finishedAt: string;
}
export interface ArchivedRun {
  id: string;
  taskId: string;
  projectName: string;
  agent: string;
  prompt: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
}
export interface ValidationStep {
  id: string;
  step: string;
  status: 'pending' | 'in_progress' | 'passed' | 'failed';
  notes?: string | null;
  evidence: string[];
  timestamp: string;
  requirements?: {
    requirementId: string;
    status: 'met' | 'partial' | 'unverified';
    summary: string;
    evidence: string[];
    /** Claimed strength; absent on reports saved before levels existed. */
    level?: EvidenceLevel;
    reasoning?: string;
    command?: string;
    output?: string;
    /** What Jackalope's local check supports. */
    checkedLevel?: EvidenceLevel;
    checkNote?: string;
  }[];
  /** A Challenge reviewer's proof: what it ran and what that printed. */
  finding?: {
    command: string;
    output: string;
    expected: string;
    breaks: string;
  } | null;
  safetyFact?: SafetyFact;
}
export interface DecisionEntry {
  id: string;
  at: string;
  phase: string;
  decision: string;
  why: string;
  evidence: string[];
  result: string;
  /** Id of an earlier entry from the same task that this one corrects. */
  supersedes?: string | null;
  /** One local check per evidence pointer, recorded when the attempt ends. */
  checks?: { pointer: string; state: string; note?: string | null }[];
}
export interface ScreenshotArtifact {
  id: string;
  name: string;
  url: string;
  filePath: string;
  width: number;
  height: number;
  timestamp: string;
}
export interface RunRequest {
  effort?: TaskEffort;
  codexSpeed?: 'standard' | 'fast';
  contextSelection?: ContextSelection;
  connectionIds?: string[];
  model?: string;
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  agent: string;
  /** Explicit account (agent-profile id) to run this agent as, if the project picked one. */
  agentProfileId?: string;
  targetBranch?: string;
  verifyCommand?: string;
  prepareCommand?: string;
  setupFiles?: string[];
  autoVerify?: boolean;
  prompt: string;
  isolated: boolean;
  /** Overrides `isolated` for a new Git task; absent keeps the `isolated` choice. */
  workspaceMode?: 'worktree' | 'branch' | 'current' | 'ask';
  previousRunId?: string;
  retryOf?: string;
  taskId?: string;
}
export interface Verification {
  command: string;
  checkedAt: string;
  tree: string | null;
  result: {
    exitCode: number | null;
    success: boolean;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    truncated: boolean;
    durationMs: number;
  };
}
export interface ChangeStats {
  files: number;
  added: number;
  removed: number;
}
