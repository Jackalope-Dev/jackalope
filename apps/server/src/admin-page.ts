import { adminHead, adminThemeStyles } from './admin-shell';
import { adminCss, adminScript } from './generated/admin-assets';

export function adminPage(nonce: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csp-nonce" content="${nonce}"><title>Jackalope admin</title>${adminHead}<style nonce="${nonce}">${adminThemeStyles}${adminCss}</style></head><body><div id="root"></div><noscript>Enable JavaScript to use the private admin console.</noscript><script nonce="${nonce}">globalThis.__webpack_nonce__=${JSON.stringify(nonce)};${adminScript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
