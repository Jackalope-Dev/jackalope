import { invokeNative } from './native/transport.ts';

interface ProjectFavicon {
  /** `data:<image type>;base64,…`; render it with `<img>` only. */
  dataUrl: string;
  /** The site address the icon came from, after redirects. */
  siteUrl: string;
}

/** The website the project's own files declare (package.json, CNAME, Cargo.toml, pyproject). */
export function detectProjectWebsite(projectPath: string): Promise<string | null> {
  return invokeNative<string | null>('project_website_detect', { projectPath });
}

/** Fetches a site's icon natively, straight from the site and only from public addresses. */
export function fetchProjectFavicon(url: string): Promise<ProjectFavicon> {
  return invokeNative<ProjectFavicon>('project_favicon_fetch', { url });
}
