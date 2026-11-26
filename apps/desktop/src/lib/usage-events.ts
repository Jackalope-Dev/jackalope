import type { Action } from '@jackalope/contracts/telemetry';
import { telemetry } from './telemetry-client.ts';

/** Counts a feature moment under the usage-sharing choice; a no-op when sharing is off. */
export function trackAction(action: Action) {
  telemetry.track({ name: 'action_used', action });
}
