import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { characterPaths } from '../desktop/src/components/mascot/character-paths.ts';
import { PRESET_THEMES } from '../desktop/src/lib/theme-engine.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const download = env.VITE_WINDOWS_DOWNLOAD_URL;
  const site = env.VITE_SITE_URL ? new URL(env.VITE_SITE_URL) : null;
  if (
    site &&
    (site.protocol !== 'https:' ||
      site.username ||
      site.password ||
      site.pathname !== '/' ||
      site.search ||
      site.hash)
  ) {
    throw new Error(
      'VITE_SITE_URL must be an HTTPS site origin, without a path, credentials, query or fragment.',
    );
  }
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 -8 128 128"><title>Jackalope</title><g fill="${PRESET_THEMES[0].accentHex}">${['farEar', 'nearEar', 'antler', 'head'].map((key) => `<path d="${characterPaths[key as keyof typeof characterPaths]}"/>`).join('')}</g></svg>`;
  if (download) {
    const url = new URL(download);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('VITE_WINDOWS_DOWNLOAD_URL must be a public HTTPS URL without credentials.');
    }
    if (!env.VITE_RELEASE_VERSION?.trim()) {
      throw new Error('Set VITE_RELEASE_VERSION when configuring a download.');
    }
  }
  return {
    plugins: [
      react(),
      {
        name: 'jackalope-brand',
        configureServer(server) {
          server.middlewares.use('/favicon.svg', (_request, response) => {
            response.setHeader('Content-Type', 'image/svg+xml');
            response.end(favicon);
          });
        },
        transformIndexHtml(html) {
          if (!site) return html;
          return html
            .replace('content="/social-preview.png"', `content="${site.origin}/social-preview.png"`)
            .replace(
              '</head>',
              `<link rel="canonical" href="${site.origin}/" /><meta property="og:url" content="${site.origin}/" /></head>`,
            );
        },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: favicon });
          if (site) {
            this.emitFile({
              type: 'asset',
              fileName: 'robots.txt',
              source: `User-agent: *\nAllow: /\nSitemap: ${site.origin}/sitemap.xml\n`,
            });
            this.emitFile({
              type: 'asset',
              fileName: 'sitemap.xml',
              source: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site.origin}/</loc></url></urlset>`,
            });
          }
        },
      },
    ],
    server: { port: 5180, strictPort: true },
    preview: { port: 5180, strictPort: true },
  };
});
