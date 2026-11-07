import { useEffect, useRef } from 'react';
import {
  beginCloudflareSignIn,
  cancelCloudflareSignIn,
  completeCloudflareSignIn,
} from './cloudflare-artifacts';
import { openExternalUrl } from './native/env';

/**
 * Connect Cloudflare in the browser: open the consent page and wait for it to return the
 * shared accounts. Unmounting while waiting cancels the native listener.
 */
export function useCloudflareSignIn() {
  const waiting = useRef(false);
  useEffect(
    () => () => {
      if (waiting.current) void cancelCloudflareSignIn().catch(() => {});
    },
    [],
  );
  return async (
    options: Parameters<typeof beginCloudflareSignIn>[0] = {},
    onConsentPage?: (url: string) => void,
  ) => {
    waiting.current = true;
    try {
      const url = await beginCloudflareSignIn(options);
      onConsentPage?.(url);
      await openExternalUrl(url);
      return await completeCloudflareSignIn();
    } finally {
      waiting.current = false;
    }
  };
}
