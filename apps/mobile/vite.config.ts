import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktop = path.resolve(import.meta.dirname, '../desktop/src');
// Tauri sets this to the machine's address when a phone or emulator loads the dev server.
const host = process.env.TAURI_DEV_HOST;

// The companion screens live in the desktop app, so its aliases and styling apply here too.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^shiki$/, replacement: path.join(desktop, 'lib/highlighter-bundle.ts') },
      { find: '@', replacement: desktop },
    ],
    dedupe: ['react', 'react-dom'],
  },
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5175 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    fs: { allow: [path.resolve(import.meta.dirname, '../..')] },
  },
});
