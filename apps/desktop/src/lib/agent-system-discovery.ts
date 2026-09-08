import { builtinAgents } from './agent-catalog.ts';
import { type AccountStatus, checkAgentProfile } from './agent-profiles.ts';
import { nativeTask, type Runner } from './task-runtime.ts';

export interface DiscoveredAgentInfo {
  id: string;
  name: string;
  vendor: string;
  description: string;
  strengths: readonly string[];
  installed: boolean;
  available: boolean;
  signedIn: boolean;
  account: string;
  detail: string;
  installCommand?: string;
  installUrl: string;
  defaultBinary: string;
  systemLoginStatus?: AccountStatus;
}

export async function getSystemAgentCatalog(existingRunners: Runner[] = []): Promise<{
  detected: DiscoveredAgentInfo[];
  availableToInstall: DiscoveredAgentInfo[];
}> {
  let runners = existingRunners;
  if (!runners.length) {
    try {
      runners = await nativeTask<Runner[]>('task_runners');
    } catch {
      runners = [];
    }
  }

  const detected: DiscoveredAgentInfo[] = [];
  const availableToInstall: DiscoveredAgentInfo[] = [];

  for (const meta of builtinAgents) {
    const runner = runners.find((r) => r.id === meta.id);
    const isInstalled = Boolean(runner?.available);

    const info: DiscoveredAgentInfo = {
      id: meta.id,
      name: meta.name,
      vendor: meta.vendor,
      description: meta.description,
      strengths: [...meta.strengths],
      installed: isInstalled,
      available: runner ? runner.available : false,
      signedIn: runner ? runner.signedIn : false,
      account: runner?.account || 'Current CLI account',
      detail: runner?.detail || '',
      installCommand: meta.installCommand,
      installUrl: meta.installUrl,
      defaultBinary: meta.defaultBinary,
    };

    if (isInstalled) {
      detected.push(info);
    } else {
      availableToInstall.push(info);
    }
  }

  return { detected, availableToInstall };
}

export async function detectSystemDefaultLogin(agentId: string): Promise<AccountStatus | null> {
  try {
    const status = await checkAgentProfile(agentId, null);
    return status;
  } catch {
    return null;
  }
}
