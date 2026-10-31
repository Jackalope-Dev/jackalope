/** One user-facing feature in a project's feature map; mirrors the native `Feature`. */
export interface FeatureMapEntry {
  name: string;
  /** Preview path review screenshots open, such as `/settings?tab=billing`. */
  page: string;
  /** How a person reaches the state worth checking. Guidance only; screenshots open `page`. */
  steps?: string;
  /** What a working feature looks like on that page. */
  working?: string;
  /** Project-relative globs of the files the feature depends on. */
  sources?: string[];
  /** The route file a suggestion came from, checked for drift. */
  routeFile?: string;
}

/** An entry whose files are gone, by its position in the checked list. */
export interface FeatureDrift {
  index: number;
  missingRouteFile?: string;
  unmatchedSources: string[];
}

/** Most entries the native side reads from a saved map. */
export const FEATURE_MAP_LIMIT = 40;

function pageKey(page: string): string {
  const path = page.trim().split('#')[0] ?? '';
  return path.replace(/\/+$/, '') || '/';
}

/** Why a page cannot be captured, or an empty string when it can. */
export function featurePageError(page: string): string {
  const path = page.trim();
  if (!path) return 'Enter the page to open, such as /settings.';
  if (!path.startsWith('/') || path.startsWith('//') || /[\s\\]/.test(path))
    return 'Use a path on the preview, starting with a single /.';
  return '';
}

/** Source globs from a text field: one per line or comma separated. */
export function parseSources(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((source) => source.trim())
    .filter(Boolean);
}

/** The saved map as the native side reads it: named entries with a page, trimmed. */
export function featureMapForRegistry(
  entries: FeatureMapEntry[] | undefined,
): FeatureMapEntry[] | undefined {
  const kept = (entries ?? [])
    .map((entry) => ({
      name: entry.name.trim(),
      page: entry.page.trim(),
      steps: entry.steps?.trim() || undefined,
      working: entry.working?.trim() || undefined,
      sources: entry.sources?.map((source) => source.trim()).filter(Boolean),
      routeFile: entry.routeFile?.trim() || undefined,
    }))
    .filter((entry) => entry.name && !featurePageError(entry.page))
    .map((entry) => ({ ...entry, sources: entry.sources?.length ? entry.sources : undefined }))
    .slice(0, FEATURE_MAP_LIMIT);
  return kept.length ? kept : undefined;
}

/** Suggestions for pages the map does not already cover. */
export function newSuggestions(
  existing: FeatureMapEntry[] | undefined,
  suggested: FeatureMapEntry[],
): FeatureMapEntry[] {
  const known = new Set((existing ?? []).map((entry) => pageKey(entry.page)));
  return suggested.filter((entry) => !known.has(pageKey(entry.page)));
}

/** The entry without the route file and globs drift found missing. */
export function withoutMissingPaths(entry: FeatureMapEntry, drift: FeatureDrift): FeatureMapEntry {
  const missing = new Set(drift.unmatchedSources);
  return {
    ...entry,
    sources: (entry.sources ?? []).filter((source) => !missing.has(source)),
    routeFile: drift.missingRouteFile ? undefined : entry.routeFile,
  };
}

/** A short description of what drift found, for the entry's row. */
export function describeDrift(drift: FeatureDrift): string {
  const missing = [
    ...(drift.missingRouteFile ? [drift.missingRouteFile] : []),
    ...drift.unmatchedSources,
  ];
  return `No longer matches any file: ${missing.join(', ')}.`;
}
