import {
  Button,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  IconButton,
  InlineNotice,
  LinkButton,
  DropdownMenu as Menu,
} from '@jackalope/ui';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { countdown, limitName, resetTime, type UsageLimit } from '../../lib/usage-limit';
import './usage-limit-banner.css';

/** Another agent or account the stopped work can move to. */
export interface LimitSwitchOption {
  id: string;
  label: string;
  agent: string;
  profileId: string | null;
}

/** Banners dismissed this session, by attempt; a later limit shows again. */
const dismissed = new Set<string>();
export const limitBannerDismissed = (runId: string) => dismissed.has(runId);

/** The current time, refreshed every second while a reset is still ahead. */
function useNow(until: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until == null || until <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}

const agentName = (agent: string) => getAgentMetadata(agent)?.name ?? agent;

/**
 * Says which account and provider hit a usage, rate or billing limit, when it resets
 * (a local time with a live countdown, or that the provider did not say), and keeps the
 * provider's own message under a toggle. Each action appears only when the caller can
 * carry it out: switching reuses the quota-handoff retry, resuming waits for the
 * reported reset and can be cancelled.
 */
export function UsageLimitBanner({
  runId,
  limit,
  scheduledAt,
  scheduleError,
  onResumeAtReset,
  onCancelResume,
  accounts = [],
  agents = [],
  onSwitch,
  onRetry,
  onDismiss,
  busy,
  error,
}: {
  runId: string;
  limit: UsageLimit;
  /** When a resume is scheduled, the reset it waits for, in milliseconds. */
  scheduledAt?: number | null;
  /** Why a scheduled resume could not start. */
  scheduleError?: string | null;
  onResumeAtReset?: () => void;
  onCancelResume?: () => void;
  accounts?: LimitSwitchOption[];
  agents?: LimitSwitchOption[];
  onSwitch?: (option: LimitSwitchOption) => void;
  /** Tries again right away on the same account. */
  onRetry?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
  error?: string;
}) {
  const now = useNow(limit.resetsAt);
  const name = limitName(limit.kind);
  const provider = agentName(limit.agent);
  const resetsAt = limit.resetsAt;
  const ahead = resetsAt != null && resetsAt > now;
  const canSchedule = !!onResumeAtReset && limit.kind !== 'billing' && resetsAt != null;
  const switchMenu = (label: string, options: LimitSwitchOption[]) =>
    onSwitch &&
    options.length > 0 && (
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="outline" disabled={busy}>
            {label}
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
            {options.map((option) => (
              <Menu.Item
                key={option.id}
                className="workspace-menu-item"
                onSelect={() => onSwitch(option)}
              >
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    );
  return (
    <InlineNotice
      tone={limit.kind === 'billing' ? 'error' : 'warning'}
      className="usage-limit"
      role="region"
      aria-label={`${name} reached`}
      action={
        <div className="usage-limit-actions">
          {canSchedule && scheduledAt == null && (
            <Button variant="outline" disabled={busy} onClick={onResumeAtReset}>
              Resume at reset
            </Button>
          )}
          {switchMenu('Switch account', accounts)}
          {switchMenu('Switch agent', agents)}
          {onRetry && (
            <Button variant="ghost" disabled={busy} onClick={onRetry}>
              Retry now
            </Button>
          )}
          {onDismiss && (
            <IconButton
              label="Dismiss"
              onClick={() => {
                dismissed.add(runId);
                onDismiss();
              }}
            >
              <X size={16} aria-hidden="true" />
            </IconButton>
          )}
        </div>
      }
    >
      <p className="usage-limit-title">
        {name} reached on {provider}
        {limit.account ? ` · ${limit.account}` : ''}
      </p>
      <p className="usage-limit-reset">
        {limit.kind === 'billing' ? (
          'Add credit with the provider or switch to another account; this limit does not reset by waiting.'
        ) : resetsAt == null ? (
          'Reset time not reported.'
        ) : (
          <>
            {ahead ? 'Resets ' : 'Reset at '}
            <time dateTime={new Date(resetsAt).toISOString()}>{resetTime(resetsAt, now)}</time>
            {ahead && (
              <span className="usage-limit-countdown" aria-hidden="true">
                {' '}
                · in {countdown(resetsAt, now)}
              </span>
            )}
          </>
        )}
      </p>
      {scheduledAt != null && (
        <p className="usage-limit-scheduled" role="status">
          {scheduleError
            ? `The resume at reset could not start: ${scheduleError}`
            : scheduledAt > now
              ? `Resumes once the limit resets at ${resetTime(scheduledAt, now)}.`
              : 'Resuming now that the limit has reset.'}{' '}
          {onCancelResume && (
            <LinkButton disabled={busy} onClick={onCancelResume}>
              {scheduleError ? 'Clear' : 'Cancel resume'}
            </LinkButton>
          )}
        </p>
      )}
      {error && (
        <p className="usage-limit-error" role="alert">
          {error}
        </p>
      )}
      {limit.message && (
        <Disclosure>
          <DisclosureSummary>Provider message</DisclosureSummary>
          <DisclosureBody>
            <pre className="usage-limit-message">{limit.message}</pre>
          </DisclosureBody>
        </Disclosure>
      )}
    </InlineNotice>
  );
}
