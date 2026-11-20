import { invokeNative } from './native/transport.ts';

interface VoiceModel {
  id: string;
  label: string;
  detail: string;
  bytes: number;
  installed: boolean;
  /** Bytes of an interrupted download that the next download resumes from. */
  partial: number;
}

export interface VoiceModels {
  models: VoiceModel[];
  /** The model this computer runs comfortably. */
  recommended: string;
}

export interface VoiceDownloadProgress {
  id: string;
  received: number;
  total: number;
  stage: 'downloading' | 'verifying';
}

export function voiceModels(): Promise<VoiceModels> {
  return invokeNative<VoiceModels>('voice_models');
}

/** Downloads, verifies and installs a model, reporting progress until it settles. */
export async function downloadVoiceModel(
  id: string,
  onProgress: (progress: VoiceDownloadProgress) => void,
): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<VoiceDownloadProgress>('voice-download', (event) => {
    if (event.payload.id === id) onProgress(event.payload);
  });
  try {
    await invokeNative('voice_download', { id });
  } finally {
    unlisten();
  }
}

export function cancelVoiceDownload(id: string): Promise<void> {
  return invokeNative('voice_cancel_download', { id });
}

export function deleteVoiceModel(id: string): Promise<void> {
  return invokeNative('voice_delete', { id });
}

/** Transcribes a 16 kHz mono WAV on this computer. */
export function transcribeLocally(id: string, wave: Uint8Array): Promise<string> {
  return invokeNative<string>('voice_transcribe', { id, audio: Array.from(wave) });
}

export function formatSize(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
