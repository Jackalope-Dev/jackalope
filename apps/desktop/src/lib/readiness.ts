import { invokeNative } from './native/transport.ts';

/** What a checkout needs before an agent can work in it. */
export interface Readiness {
  head: string;
  branch: string;
  changes: string;
  recentChanges: string;
  prepareCommand: string | null;
  verifyCommand: string | null;
  previewCommand: string | null;
  dependenciesMissing: boolean;
  missingConfiguration: string[];
  notes: string[];
}

export const projectReadiness = (path: string) =>
  invokeNative<Readiness>('project_readiness', { path });
