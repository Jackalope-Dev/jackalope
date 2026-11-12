import { EchoMark } from '@jackalope/brand/echo';
import type { ReactNode } from 'react';
import { type Activity, headline, mood } from './mood.ts';

/**
 * The home header: the Jackalope head with its echo lines, whose mood follows real work —
 * echoes fold while something runs, it tilts toward you when something needs you, and it
 * dims when no computer answers. Nothing here animates without activity behind it.
 */
export function MascotHeader({
  title,
  activity,
  children,
}: {
  title: string;
  activity: Activity;
  children?: ReactNode;
}) {
  const current = mood(activity);
  return (
    <header className="mobile-hero">
      <span className="mobile-mascot" data-mood={current} aria-hidden="true">
        <EchoMark animated={current === 'working'} />
        {activity.needsYou > 0 && <span className="mobile-mascot-count">{activity.needsYou}</span>}
      </span>
      <div className="mobile-hero-text">
        <h1>{title}</h1>
        <p className="mobile-hero-status" role="status">
          {headline(activity)}
        </p>
      </div>
      {children}
    </header>
  );
}
