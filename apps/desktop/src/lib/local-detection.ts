import { isTauriEnvironment } from './native/env.ts';
import { invokeNative } from './native/transport.ts';

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
  if (isTauriEnvironment()) return invokeNative<LocalLlmEndpoint[]>('system_detect_local_llms');
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
  return isTauriEnvironment() ? invokeNative<DetectedKey[]>('system_detect_env_keys') : [];
}

export const importDetectedKey = (keyName: string, profileName?: string) =>
  invokeNative<{ id: string; name: string }>('agent_import_detected_key', { keyName, profileName });
