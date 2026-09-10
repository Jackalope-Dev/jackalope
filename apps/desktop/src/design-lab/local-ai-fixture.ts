import type { LocalInspection } from '../lib/local-ai';

export const localAiFixture: LocalInspection = {
  hardware: {
    os: 'windows',
    arch: 'x86_64',
    memoryBytes: 32 * 1024 ** 3,
    availableMemoryBytes: 19 * 1024 ** 3,
    freeDiskBytes: 168e9,
    gpu: 'NVIDIA GeForce RTX 4070',
    diskLocation: 'Sample model drive',
  },
  models: [
    {
      id: 'qwen3.5:4b',
      name: 'Qwen 3.5 · 4B',
      downloadBytes: 3.4e9,
      recommendedMemoryGb: 16,
      description: 'Try focused edits and explanations. Review its work carefully.',
    },
    {
      id: 'qwen3.5:9b',
      name: 'Qwen 3.5 · 9B',
      downloadBytes: 6.6e9,
      recommendedMemoryGb: 24,
      description: 'More room for reasoning on a capable computer. A GPU is recommended.',
    },
    {
      id: 'qwen3-coder:30b',
      name: 'Qwen3 Coder · 30B',
      downloadBytes: 19e9,
      recommendedMemoryGb: 48,
      description: 'A coding specialist for high-memory machines. GPU memory matters for speed.',
    },
  ],
  installedModels: ['qwen3.5:4b'],
  ollamaOnline: true,
  opencodeInstalled: true,
  canInstall: false,
  runtimeDiskBytes: 4e9,
  catalogCheckedAt: '2026-09-10',
};
