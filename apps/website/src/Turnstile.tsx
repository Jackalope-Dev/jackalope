import { type RefObject, useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      getResponse: (widget: string) => string | undefined;
      reset: (widget: string) => void;
      remove: (widget: string) => void;
    };
  }
}

/** jackalope.dev's managed widget; site keys are public. */
const productionSiteKey = '0x4AAAAAAGN_ZlrzTmqeOCHJ';
/**
 * Public site key. A set VITE_TURNSTILE_SITE_KEY wins, and an empty one turns the
 * challenge off; unset, production builds use jackalope.dev's widget.
 */
const turnstileSiteKey = (
  import.meta.env.VITE_TURNSTILE_SITE_KEY ?? (import.meta.env.PROD ? productionSiteKey : '')
).trim();
const script = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<void> | null = null;

function loadTurnstile() {
  loading ??= new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = script;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      loading = null;
      reject(new Error('Turnstile did not load'));
    };
    document.head.append(tag);
  });
  return loading;
}

export interface TurnstileHandle {
  /** The current token, or an empty string before the challenge completes. */
  token: () => string;
  /** Tokens are single-use, so every submission attempt needs a fresh one. */
  reset: () => void;
}

/** Renders one widget for `action` and keeps its id so the form can reset it. */
export function TurnstileWidget({
  action,
  handle,
}: {
  action: string;
  handle: RefObject<TurnstileHandle | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!turnstileSiteKey || !container.current) return;
    let widget = '';
    let alive = true;
    void loadTurnstile()
      .then(() => {
        if (!alive || !container.current || !window.turnstile) return;
        widget = window.turnstile.render(container.current, {
          sitekey: turnstileSiteKey,
          action,
          appearance: 'interaction-only',
        });
        handle.current = {
          token: () => window.turnstile?.getResponse(widget) ?? '',
          reset: () => window.turnstile?.reset(widget),
        };
      })
      .catch(() => {});
    return () => {
      alive = false;
      handle.current = null;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [action, handle]);
  // Always rendered: prerendering runs outside a production build, where the default key is
  // off, and a container only one side renders fails hydration. It is hidden while empty.
  return <div ref={container} className="signup-turnstile" />;
}
