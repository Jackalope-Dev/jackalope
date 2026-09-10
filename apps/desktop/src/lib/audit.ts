export type AuditCategory = 'routing' | 'failover' | 'quota' | 'execution' | 'discovery';

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
  agent?: string;
  model?: string;
  taskId?: string;
  runId?: string;
  details?: Record<string, unknown>;
}
