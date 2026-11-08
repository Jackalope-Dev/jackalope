import { useEffect, useRef } from 'react';
import {
  beginCloudflareSignIn,
  cancelCloudflareSignIn,
  completeCloudflareSignIn,
} from '../lib/cloudflare-artifacts';
import { errorCode } from '@jackalope/contracts/errors';
import { openExternalUrl } from '../lib/native/env';

/**
 * Connect Cloudflare in the browser: open the consent page and wait for it to return the
 * shared accounts. Resolves `null` when the sign-in was canceled, by a newer sign-in or by
 * unmounting while waiting, which also cancels the native listener.
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
    } catch (cause) {
      if (errorCode(cause) === 'canceled') return null;
      throw cause;
    } finally {
      waiting.current = false;
    }
  };
}
