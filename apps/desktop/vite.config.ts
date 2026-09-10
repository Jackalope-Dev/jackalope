import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(import.meta.dirname, 'index.html'),
        ...(mode === 'lab' ? { design: path.resolve(import.meta.dirname, 'design-lab.html') } : {}),
      },
    },
  },
  worker: { format: 'es' },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^shiki$/,
        replacement: path.resolve(import.meta.dirname, './src/lib/highlighter-bundle.ts'),
      },
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    watch: { ignored: ['**/src-tauri/**'] },
    port: 5173,
    strictPort: true,
    host: true,
  },
}));
