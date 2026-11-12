import { IconButton } from '@jackalope/ui';
import { X } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect } from 'react';
import { botGreeting } from '../../lib/bot-presentation';
import type { BotAppearance } from '../../stores/botStore';
import { BotAvatar, botColor } from './BotAvatar';
import './bot-cast.css';

/**
 * A bot as a character card: its character on a wash of its own colour, then its name
 * and one line. Templates, the editor's preview and the hello after saving all use it.
 */
export function BotCastCard({
  appearance,
  agent,
  name,
  line,
  lineId,
  hero = false,
  children,
}: {
  appearance?: BotAppearance;
  agent?: string;
  name: string;
  line: string;
  lineId?: string;
  /** Names the character for the view transition from a template into the editor. */
  hero?: boolean;
  children?: ReactNode;
}) {
  const tint = botColor(appearance);
  return (
    <span
      className="bots-cast"
      style={tint ? ({ '--bot-tint': tint } as CSSProperties) : undefined}
    >
      <span className="bots-cast-stage" data-hero={hero || undefined}>
        <BotAvatar appearance={appearance} agent={agent} size="lg" />
        {children}
      </span>
      <span className="bots-cast-copy">
        <strong>{name}</strong>
        <span className="bots-cast-line" id={lineId}>
          {line}
        </span>
      </span>
    </span>
  );
}

/** How long a new bot's hello stays before it leaves on its own. */
const HELLO_MS = 12_000;

/** A just-created bot says hello once, from its own name and role. */
export function BotHello({
  appearance,
  agent,
  name,
  role,
  onDismiss,
}: {
  appearance?: BotAppearance;
  agent?: string;
  name: string;
  role: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, HELLO_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);
  const tint = botColor(appearance);
  return (
    <div
      className="bots-hello"
      role="status"
      style={tint ? ({ '--bot-tint': tint } as CSSProperties) : undefined}
    >
      <span className="bots-hello-character">
        <BotAvatar appearance={appearance} agent={agent} />
      </span>
      <p>{botGreeting(name, role)}</p>
      <IconButton variant="ghost" label="Dismiss" onClick={onDismiss}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
