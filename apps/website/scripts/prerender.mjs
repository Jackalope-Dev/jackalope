import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer, loadEnv } from 'vite';

const server = await createServer({
  mode: 'production',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
try {
  const { render } = await server.ssrLoadModule('/src/entry-server.tsx');
  const { pageHtml, routes } = await server.ssrLoadModule('/src/seo.ts');
  const { siteOrigin } = await server.ssrLoadModule('/src/content.ts');
  const origin = new URL(loadEnv('production', process.cwd(), 'VITE_').VITE_SITE_URL || siteOrigin)
    .origin;
  const { applyThemeTokens, DEFAULT_THEME } = await server.ssrLoadModule('@jackalope/brand/theme');
  const tokens = new Map();
  const previousDocument = globalThis.document;
  try {
    globalThis.document = {
      documentElement: { style: { setProperty: (name, value) => tokens.set(name, value) } },
    };
    applyThemeTokens({ ...DEFAULT_THEME, isDark: false, atmosphere: 18 });
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
      .replace('<html lang="en">', `<html lang="en" style="${themeStyle}">`)
      .replace('<div id="root"></div>', `<div id="root">${render(path)}</div>`);
    const target = resolve('dist', path === '/404/' ? '404.html' : `${path.slice(1)}index.html`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
  }
  console.log(`Prerendered ${routes.length} routes and the not-found page.`);
} finally {
  await server.close();
}
