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
  onSelect,
}: {
  limit: number;
  remaining: number;
  accepted: number;
  disabled?: boolean;
  actionLabel?: string;
  onSelect: (number: number, button: HTMLButtonElement) => void;
}) {
  return (
    <div className="brand-pass-allowance">
      <ol className="brand-pass-tickets" aria-label="Instant Access Pass allowance">
        {Array.from({ length: Math.min(limit, 100) }, (_, index) => index + 1).map((number) => {
          const state =
            number <= accepted ? 'Claimed' : number <= limit - remaining ? 'Reserved' : 'Available';
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
                aria-label={`Instant Access Pass ${number}: ${state}${state === 'Available' ? `. ${actionLabel}` : ''}`}
                onClick={(event) => onSelect(number, event.currentTarget)}
              >
                <span className="brand-pass-ticket-top">
                  <svg viewBox="38 3 105 117" fill="currentColor" aria-hidden="true">
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
                  <span>{state === 'Available' ? actionLabel : state}</span>
                  {state === 'Available' && (
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14m-7-7 7 7-7 7" />
                    </svg>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
