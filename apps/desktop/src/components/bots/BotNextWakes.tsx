import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useBotHubStore } from '../../lib/bot-hub';
import { nextWakes } from '../../lib/bot-presentation';
import { useBotStore } from '../../stores/botStore';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { BotAvatar } from './BotAvatar';
import './bots.css';
import './bot-cast.css';

const HOURS = 24;
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * When each bot next wakes in the coming day, from the hub's own next check times.
 * The strip places each bot along the day; the list beside it carries the same times
 * in text for keyboard and screen-reader use.
 */
export function BotNextWakes() {
  const bots = useBotStore((state) => state.bots);
  const { states, paused } = useBotHubStore(
    useShallow((state) => ({ states: state.wakes, paused: state.paused })),
  );
  // Re-read once a minute so passed wakes leave and the strip's "now" stays put.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const upcoming = useMemo(() => nextWakes(bots, states, now, HOURS), [bots, states, now]);
  if (!bots.some((bot) => bot.wakes.some((wake) => wake.enabled))) return null;
  const span = HOURS * 3_600_000;
  return (
    <section className="workspace-section workspace-stack" aria-labelledby="bots-next-wakes">
      <WorkspaceSectionHeading titleId="bots-next-wakes" title="Next wakes" />
      {paused ? (
        <p className="bots-next-empty">
          Wake-ups are paused. Bots only work when you message them.
        </p>
      ) : upcoming.length === 0 ? (
        <p className="bots-next-empty">No bot wakes in the next 24 hours.</p>
      ) : (
        <div className="bots-next">
          <div className="bots-next-strip" aria-hidden="true">
            <span className="bots-next-tick" data-edge="start">
              Now
            </span>
            <span className="bots-next-tick" data-edge="end">
              +24h
            </span>
            {upcoming.map((wake) => {
              const bot = bots.find((item) => item.id === wake.botId);
              const at = (wake.at.getTime() - now.getTime()) / span;
              return (
                <span
                  key={wake.botId}
                  className="bots-next-mark"
                  style={{ '--at': at } as CSSProperties}
                  title={`${bot?.name} · ${timeFormat.format(wake.at)}`}
                >
                  <BotAvatar appearance={bot?.appearance} agent={bot?.agent} />
                </span>
              );
            })}
          </div>
          <ol className="bots-next-list">
            {upcoming.map((wake) => {
              const bot = bots.find((item) => item.id === wake.botId);
              const name = bot?.wakes.find((item) => item.id === wake.wakeId)?.name;
              return (
                <li key={wake.botId}>
                  <time dateTime={wake.at.toISOString()}>{timeFormat.format(wake.at)}</time>
                  <strong>{bot?.name}</strong>
                  {name && <span>{name}</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
