import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createServer, loadEnv } from 'vite';
import { verifySeo } from './verify-seo.mjs';

const server = await createServer({
  mode: 'production',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
try {
  const { render } = await server.ssrLoadModule('/src/entry-server.tsx');
  const { pageHtml, routes, mirrorHeaderRules, movedPages } =
    await server.ssrLoadModule('/src/seo.ts');
  const { siteOrigin, pages } = await server.ssrLoadModule('/src/content.ts');
  const origin = new URL(loadEnv('production', process.cwd(), 'VITE_').VITE_SITE_URL || siteOrigin)
    .origin;
  const { applyThemeTokens } = await server.ssrLoadModule('@jackalope/brand/theme');
  const { DEFAULT_WEBSITE_THEME } = await server.ssrLoadModule('/src/theme.ts');
  const tokens = new Map();
  const previousDocument = globalThis.document;
  try {
    globalThis.document = {
      documentElement: { style: { setProperty: (name, value) => tokens.set(name, value) } },
    };
    applyThemeTokens(DEFAULT_WEBSITE_THEME);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  const themeStyle = [...tokens].map(([name, value]) => `${name}:${value}`).join(';');
  let template = '';
  const templatePath = resolve('dist/index.html');
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      template = await readFile(templatePath, 'utf8');
      break;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  for (const path of [...routes, '/404/']) {
    const html = pageHtml(template, path, origin)
      .replace('</head>', `<style>:root{${themeStyle}}</style></head>`)
      .replace('<div id="root"></div>', `<div id="root">${render(path)}</div>`);
    const target = resolve('dist', path === '/404/' ? '404.html' : `${path.slice(1)}index.html`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
  }
  // Static assets' auto-trailing-slash answers /page with a temporary 307; list a
  // permanent redirect for every prerendered page so search engines keep one URL.
  for (const [from, to] of Object.entries(movedPages)) {
    if (routes.includes(from) || !routes.includes(to))
      throw new Error(`Moved page ${from} must not be a route and must point at one.`);
  }
  await writeFile(
    resolve('dist/_redirects'),
    `${[
      ...Object.entries(movedPages).flatMap(([from, to]) => [
        `${from.slice(0, -1)} ${to} 301`,
        `${from} ${to} 301`,
      ]),
      ...routes
        .filter((path) => path !== '/' && path.endsWith('/'))
        .map((path) => `${path.slice(0, -1)} ${path} 301`),
    ].join('\n')}\n`,
  );
  const published = (await readdir(resolve('dist'), { recursive: true })).map((name) =>
    name.split(sep).join('/'),
  );
  await appendFile(resolve('dist/_headers'), `\n${mirrorHeaderRules(published, origin)}`);
  console.log(`Prerendered ${routes.length} routes and the not-found page.`);
  await verifySeo(resolve('dist'), pages, origin);
} finally {
  await server.close();
}
