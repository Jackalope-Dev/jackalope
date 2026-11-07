import { invokeNative } from './native/transport.ts';

export type DeployOutcome = 'deployed' | 'failed' | 'check-failed' | 'rolled-back';

interface DeployRecord {
  head: string;
  startedAt: string;
  finishedAt: string;
  outcome: DeployOutcome;
  output: string;
}

export interface DeployStatus {
  /** The committed policy deploys this branch. */
  configured: boolean;
  projectPath?: string;
  branch?: string;
  pushedHead?: string | null;
  pushError?: string | null;
  deployedHead?: string | null;
  deploying?: string | null;
  /** Why automatic merging is paused for the project. */
  halted?: string | null;
  history?: DeployRecord[];
}

export const deployStatus = (projectPath: string) =>
  invokeNative<DeployStatus>('deploy_status', { projectPath });
export const deployAgain = (projectPath: string) =>
  invokeNative<void>('deploy_again', { projectPath });

export const DEPLOY_OUTCOME: Record<DeployOutcome, string> = {
  deployed: 'Deployed',
  failed: 'Deploy failed',
  'check-failed': 'Check failed after deploy',
  'rolled-back': 'Rolled back',
};

/** The state the map's branch shows. */
export function deliveryPhase(status: DeployStatus | null) {
  if (!status) return null;
  if (status.deploying) return 'deploying';
  if (status.halted) return 'paused';
  if (status.history?.[0]?.outcome === 'deployed') return 'deployed';
  return null;
}
