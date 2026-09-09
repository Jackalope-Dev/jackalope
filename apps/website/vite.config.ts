import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { characterPaths } from '@jackalope/brand/character';
import { Resvg } from '@resvg/resvg-js';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import changelog from './src/changelog.json' with { type: 'json' };
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
  const mark = (['antler', 'farEar', 'nearEar', 'head'] as const)
    .map((key) => `<path d="${characterPaths[key]}"/>`)
    .join('');
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="25 -8 128 128"><title>Jackalope</title><rect x="25" y="-8" width="128" height="128" rx="26" fill="#ffffff"/><g fill="#171717">${mark}</g></svg>`;
  const renderIcon = (size: number) =>
    new Resvg(favicon, { fitTo: { mode: 'width', value: size } }).render().asPng();
  // Published so the admin broadcast composer can read the same product notes
  // the site shows, instead of keeping a second copy that drifts.
  const files = {
    ...discoveryFiles(site.origin, download ? env.VITE_RELEASE_VERSION : undefined),
    'changelog.json': JSON.stringify(changelog),
  };
  const icons = {
    'favicon-32.png': renderIcon(32),
    'icon-128.png': renderIcon(128),
    'icon-256.png': renderIcon(256),
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
                    : name.endsWith('.json')
                      ? 'application/json'
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
