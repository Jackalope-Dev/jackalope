type Conversion = 'signup' | 'signup_confirmed' | 'download';

declare global {
  interface Window {
    lopebase?: { conversion: (name: string) => void };
  }
}

const reported = new Set<Conversion>();

/**
 * Reports a funnel step to the LopeBase page counter, at most once per page load
 * and with no personal data. The counter tag is only added to production builds
 * of the canonical site (see vite.config.ts), so elsewhere this does nothing.
 */
export function reportConversion(name: Conversion) {
  if (typeof window === 'undefined' || reported.has(name)) return;
  reported.add(name);
  try {
    window.lopebase?.conversion(name);
  } catch {
    /* Measurement must never break the page. */
  }
}
