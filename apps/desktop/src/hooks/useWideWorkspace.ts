import { useSyncExternalStore } from 'react';

/**
 * Wide enough to show review, preview or a terminal beside the conversation
 * without squeezing either. Narrower windows give the tool the full width.
 */
const query = '(min-width: 1280px)';
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const snapshot = () => window.matchMedia(query).matches;

/** Whether tools open beside the conversation when a person has not chosen. */
export function useWideWorkspace() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
