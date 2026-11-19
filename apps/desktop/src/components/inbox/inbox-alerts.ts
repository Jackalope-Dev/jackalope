import { getAgentMetadata } from '../../lib/agent-catalog';
import { capacityWindowDisplay, capacityWindowName } from '../../lib/capacity-display';
import type { CapacityRecord } from '../../stores/capacityStore';
import type { CompanionNotice } from '../../stores/companionStore';

/** Task notices repeat what the work sections already list, so Inbox leaves them out. */
const COVERED_SOURCES = new Set(['tasks']);

/** App alerts the companion collects, without the ones Inbox shows as work. */
export function companionAlerts(sources: Record<string, CompanionNotice[]>): CompanionNotice[] {
  return Object.entries(sources)
    .filter(([source]) => !COVERED_SOURCES.has(source))
    .flatMap(([, notices]) => notices);
}

/**
 * Account allowances that are used up or running low, from the last reported reading.
 * Stale or unreported windows are skipped rather than guessed at.
 */
export function allowanceAlerts(
  records: CapacityRecord[],
  enabled: (agent: string) => boolean,
  now: number,
  onOpen: () => void,
): CompanionNotice[] {
  return records.flatMap((record) => {
    if (record.status === 'notInstalled' || !enabled(record.agent)) return [];
    const agent = getAgentMetadata(record.agent)?.name ?? record.agent;
    return record.windows.flatMap((window) => {
      const display = capacityWindowDisplay(record, window, now);
      if (display.tone !== 'low' && display.tone !== 'empty') return [];
      const name = capacityWindowName(window).toLowerCase();
      const resets = window.resetsAt
        ? ` Resets ${new Date(window.resetsAt * 1000).toLocaleString(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}.`
        : '';
      return [
        {
          id: `allowance:${record.agent}:${record.account}:${window.window}:${window.resetsAt ?? ''}`,
          kind: display.tone === 'empty' ? 'attention' : 'info',
          title:
            display.tone === 'empty'
              ? `${agent} allowance is used up`
              : `${agent} allowance is running low`,
          detail: `${display.label} in the ${name}.${resets}`,
          actionLabel: 'View usage',
          onOpen,
        } satisfies CompanionNotice,
      ];
    });
  });
}
