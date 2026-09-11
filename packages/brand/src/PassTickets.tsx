import { ArrowRight, Check } from 'lucide-react';
import type { CSSProperties } from 'react';
import { characterPaths } from './character';
import { PRESET_THEMES, themeTokens } from './tokens';
import './pass-tickets.css';

export function PassTickets({
  limit,
  remaining,
  accepted,
  disabled = false,
  actionLabel = 'Share a pass',
  copiedPass,
  onSelect,
}: {
  limit: number;
  remaining: number;
  accepted: number;
  disabled?: boolean;
  actionLabel?: string;
  copiedPass?: number;
  onSelect: (number: number, button: HTMLButtonElement) => void;
}) {
  return (
    <div className="brand-pass-allowance">
      <ol className="brand-pass-tickets" aria-label="Instant Access Pass allowance">
        {Array.from({ length: Math.min(limit, 100) }, (_, index) => index + 1).map((number) => {
          const state =
            number <= accepted ? 'Claimed' : number <= limit - remaining ? 'Reserved' : 'Available';
          const copied = state === 'Available' && copiedPass === number;
          const label = copied ? 'Copied' : actionLabel;
          return (
            <li
              key={number}
              data-state={state}
              style={
                {
                  '--ticket-color': themeTokens(PRESET_THEMES[(number + 1) % 5])['--color-action'],
                } as CSSProperties
              }
            >
              <button
                type="button"
                className="brand-pass-ticket"
                disabled={state !== 'Available' || disabled}
                aria-label={`Instant Access Pass ${number}: ${state}${state === 'Available' ? `. ${label}` : ''}`}
                onClick={(event) => onSelect(number, event.currentTarget)}
              >
                <span className="brand-pass-ticket-top">
                  <svg viewBox="38 4 105 117" fill="currentColor" aria-hidden="true">
                    <path d={characterPaths.farEar} />
                    <path d={characterPaths.nearEar} />
                    <path d={characterPaths.antler} />
                    <path d={characterPaths.head} />
                  </svg>
                  <span>No. {String(number).padStart(2, '0')}</span>
                </span>
                <strong>
                  Instant
                  <br />
                  Access
                </strong>
                <span className="brand-pass-ticket-stub">
                  <span>{state === 'Available' ? label : state}</span>
                  {state === 'Available' &&
                    (copied ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      <ArrowRight size={16} aria-hidden="true" />
                    ))}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
