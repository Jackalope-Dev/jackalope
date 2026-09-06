import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { normalizePath, siteOrigin } from './src/content.ts';
import { discoveryFiles, pageHtml, routes } from './src/seo.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const download = env.VITE_WINDOWS_DOWNLOAD_URL;
  const site = new URL(env.VITE_SITE_URL || siteOrigin);
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
  const favicon = readFileSync(
    new URL('../desktop/src-tauri/icons/source-icon.svg', import.meta.url),
    'utf8',
  );
  const files = discoveryFiles(site.origin, download ? env.VITE_RELEASE_VERSION : undefined);
  const icons = {
    'favicon-32.png': readFileSync(
      new URL('../desktop/src-tauri/icons/32x32.png', import.meta.url),
    ),
    'icon-128.png': readFileSync(
      new URL('../desktop/src-tauri/icons/128x128.png', import.meta.url),
    ),
    'icon-256.png': readFileSync(
      new URL('../desktop/src-tauri/icons/128x128@2x.png', import.meta.url),
    ),
  };
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
          server.middlewares.use((request, response, next) => {
            const name = request.url?.split('?')[0]?.slice(1) || '';
            if (name === 'favicon.svg') {
              response.setHeader('Content-Type', 'image/svg+xml');
              response.end(favicon);
            } else if (Object.hasOwn(icons, name)) {
              response.setHeader('Content-Type', 'image/png');
              response.end(icons[name as keyof typeof icons]);
            } else if (Object.hasOwn(files, name)) {
              response.setHeader(
                'Content-Type',
                name.endsWith('.xml')
                  ? 'application/xml'
                  : name.endsWith('.webmanifest')
                    ? 'application/manifest+json'
                    : 'text/plain; charset=utf-8',
              );
              response.end(files[name as keyof typeof files]);
            } else next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url || '/', 'http://localhost').pathname;
            if (
              !request.headers.accept?.includes('text/html') ||
              routes.includes(normalizePath(pathname)) ||
              /\.(?!html$)[a-z0-9]+$/i.test(pathname)
            )
              return next();
            response.statusCode = 404;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(
              request.method === 'HEAD'
                ? undefined
                : readFileSync(resolve(server.config.root, server.config.build.outDir, '404.html')),
            );
          });
        },
        transformIndexHtml(html, context) {
          return pageHtml(html, context.path === '/index.html' ? '/' : context.path, site.origin);
        },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: favicon });
          for (const [fileName, source] of Object.entries({ ...files, ...icons }))
            this.emitFile({ type: 'asset', fileName, source });
        },
      },
    ],
    server: { port: 5180, strictPort: true },
    preview: { port: 5180, strictPort: true },
  };
});
