import { isAccessToken } from '@jackalope/contracts/links';
export function waitlistReferral() {
  if (typeof window === 'undefined') return undefined;
  const current = new URL(window.location.href).searchParams.get('ref');
  try {
    if (current && isAccessToken(current)) {
      sessionStorage.setItem('jackalope-waitlist-ref', current);
      return current;
    }
    const saved = sessionStorage.getItem('jackalope-waitlist-ref');
    return saved && isAccessToken(saved) ? saved : undefined;
  } catch {
    return current && isAccessToken(current) ? current : undefined;
  }
}
