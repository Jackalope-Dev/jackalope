/**
 * Links the access service emails and the website opens. Capability tokens
 * travel in the fragment so they never reach server logs; the website reads
 * them from there.
 */

/** A capability, session or invitation token: 32 random bytes as hex. */
export const ACCESS_TOKEN = /^[a-f0-9]{64}$/;

export function isAccessToken(value: unknown): value is string {
  return typeof value === 'string' && ACCESS_TOKEN.test(value);
}

export const WEBSITE_PAGES = {
  home: '/',
  access: '/access/',
  download: '/download/',
  feedback: '/feedback/',
  waitlist: '/waitlist/',
  privacy: '/privacy/',
} as const;

/**
 * A website page link. `fragment` is either named parameters (`#token=...`) or a
 * bare section id (`#invitations`).
 */
export function websiteLink(
  origin: string,
  page: keyof typeof WEBSITE_PAGES,
  {
    query,
    fragment,
  }: { query?: Record<string, string>; fragment?: Record<string, string> | string } = {},
) {
  const search = query ? `?${new URLSearchParams(query)}` : '';
  const hash =
    typeof fragment === 'string'
      ? `#${fragment}`
      : fragment
        ? `#${new URLSearchParams(fragment)}`
        : '';
  return `${origin}${WEBSITE_PAGES[page]}${search}${hash}`;
}
