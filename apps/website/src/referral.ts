export function waitlistReferral() {
  if (typeof window === 'undefined') return undefined;
  const current = new URL(window.location.href).searchParams.get('ref');
  try {
    if (current && /^[a-f0-9]{64}$/.test(current)) {
      sessionStorage.setItem('jackalope-waitlist-ref', current);
      return current;
    }
    const saved = sessionStorage.getItem('jackalope-waitlist-ref');
    return saved && /^[a-f0-9]{64}$/.test(saved) ? saved : undefined;
  } catch {
    return current && /^[a-f0-9]{64}$/.test(current) ? current : undefined;
  }
}
