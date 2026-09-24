export interface TaskFollowUp {
  id: string;
  taskId: string;
  previousRunId: string;
  prompt: string;
  runId: string | null;
  paused: boolean;
  error: string | null;
}
