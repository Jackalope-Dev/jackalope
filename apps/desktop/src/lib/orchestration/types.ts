export type AgentRunnerId = 'codex' | 'claude' | 'grok';

export type TaskComplexity = 'trivial' | 'standard' | 'complex' | 'critical';

export type TaskIntent =
  | 'refactoring'
  | 'debugging'
  | 'feature'
  | 'architecture'
  | 'documentation'
  | 'testing'
  | 'review'
  | 'general';

export interface AgentModel {
  id: string;
  name: string;
  runnerId: AgentRunnerId;
  description: string;
  contextWindow: number;
  capabilities: {
    coding: number; // 0-10 scale
    reasoning: number;
    speed: number;
    multiFile: number;
  };
  relativeCost: 'free' | 'low' | 'medium' | 'high';
  isDefault?: boolean;
}

export type RoutingPreference = 'auto' | 'quality' | 'speed' | 'cost' | 'manual';

export interface CandidateScore {
  agent: AgentRunnerId;
  model: string;
  totalScore: number;
  capabilityScore: number;
  capacityScore: number;
  affinityScore: number;
  preferenceScore: number;
  available: boolean;
  notes: string[];
}

export interface RoutingDecision {
  id: string;
  timestamp: string;
  taskTitle: string;
  detectedIntent: TaskIntent;
  complexity: TaskComplexity;
  chosenAgent: AgentRunnerId;
  chosenModel: string;
  explanation: string;
  preference: RoutingPreference;
  candidates: CandidateScore[];
  isManualOverride?: boolean;
}

export type FailoverReason =
  | 'quota_exceeded'
  | 'rate_limited'
  | 'process_crashed'
  | 'auth_expired'
  | 'runner_unavailable'
  | 'execution_error';

export interface FailoverEvent {
  id: string;
  originalRunId: string;
  taskId: string;
  projectId: string;
  failedAgent: AgentRunnerId;
  failedModel?: string;
  reason: FailoverReason;
  errorSnippet: string;
  fallbackAgent: AgentRunnerId;
  fallbackModel: string;
  status: 'attempting' | 're_routed' | 'resolved' | 'failed';
  timestamp: string;
  reRoutedRunId?: string;
}

export type AuditCategory =
  | 'routing'
  | 'failover'
  | 'quota'
  | 'execution'
  | 'discovery';

export type AuditSeverity = 'info' | 'success' | 'warning' | 'error';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  projectId: string;
  projectName: string;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  message: string;
  agent?: AgentRunnerId;
  model?: string;
  taskId?: string;
  runId?: string;
  details?: Record<string, unknown>;
}

export interface OpenTaskItem {
  id: string;
  title: string;
  sourceFile: string;
  status: 'open' | 'completed';
  category?: string;
}

export interface DiscoveredCodebaseMemory {
  projectId: string;
  projectName: string;
  projectPath: string;
  summary: string;
  techStack: string[];
  conventions: string[];
  openTasks: OpenTaskItem[];
  roadmapItems: string[];
  buildCommands: string[];
  testCommands: string[];
  lastScannedAt: string;
  tokenUsageEstimate: number;
  scanDurationMs: number;
  sourceFilesDetected: string[];
  metaAgent?: string;
}
