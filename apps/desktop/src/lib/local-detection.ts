import { isTauriEnvironment } from './tauri-bridge.ts';

export interface LocalLlmEndpoint {
  service: string;
  port: number;
  endpoint: string;
  online: boolean;
  models: string[];
}

export interface DetectedKey {
  keyName: string;
  provider: string;
  targetAgent: string;
  source: string;
  maskedPreview: string;
  isConfigured: boolean;
}

export async function detectLocalLlms(): Promise<LocalLlmEndpoint[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<LocalLlmEndpoint[]>('system_detect_local_llms');
  }
  return [
    {
      service: 'Ollama',
      port: 11434,
      endpoint: 'http://127.0.0.1:11434',
      online: false,
      models: [],
    },
    {
      service: 'LM Studio',
      port: 1234,
      endpoint: 'http://127.0.0.1:1234',
      online: false,
      models: [],
    },
    {
      service: 'llama.cpp / LocalAI',
      port: 8080,
      endpoint: 'http://127.0.0.1:8080',
      online: false,
      models: [],
    },
  ];
}

export async function detectEnvKeys(): Promise<DetectedKey[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<DetectedKey[]>('system_detect_env_keys');
  }
  return [];
}

export async function importDetectedKey(
  keyName: string,
  profileName?: string,
): Promise<{ id: string; name: string }> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<{ id: string; name: string }>('agent_import_detected_key', {
      keyName,
      profileName,
    });
  }
  throw new Error('Open the desktop app to import API keys.');
}
