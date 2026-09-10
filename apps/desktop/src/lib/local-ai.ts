export interface LocalModel {
  id: string;
  name: string;
  downloadBytes: number;
  recommendedMemoryGb: number;
  description: string;
}
export interface LocalInspection {
  hardware: {
    os: string;
    arch: string;
    memoryBytes: number | null;
    availableMemoryBytes: number | null;
    freeDiskBytes: number | null;
    gpu: string | null;
    diskLocation: string | null;
  };
  models: LocalModel[];
  installedModels: string[];
  ollamaOnline: boolean;
  opencodeInstalled: boolean;
  canInstall: boolean;
  runtimeDiskBytes: number;
  catalogCheckedAt: string;
}
export interface LocalProgress {
  phase: string;
  message: string;
  completed: number;
  total: number | null;
}
export interface LocalVerification {
  model: string;
  elapsedMs: number;
  checkedAt: string;
}

export function formatSize(bytes: number | null) {
  if (bytes === null) return 'Not detected';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.ceil(bytes / 1e6)} MB`;
}
export function formatMemory(bytes: number | null) {
  return bytes === null ? 'Not detected' : `${Math.round(bytes / 1024 ** 3)} GB`;
}
export function modelFit(model: LocalModel, inspection: LocalInspection) {
  const memory = inspection.hardware.memoryBytes;
  return memory === null
    ? 'unknown'
    : memory / 1024 ** 3 + 0.5 >= model.recommendedMemoryGb
      ? 'fits'
      : 'limited';
}
export function downloadPercent(progress: LocalProgress | null) {
  return progress?.total && progress.total > 0
    ? Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)))
    : undefined;
}
