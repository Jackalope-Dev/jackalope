import { Button } from '@jackalope/ui';
import { Square, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { readAloud, speechSupported, stopReading, useReading } from '../../lib/read-aloud';
import { trackAction } from '../../lib/usage-events';

/**
 * Reads a reply aloud with the system voice, only when asked. Nothing leaves this
 * computer, and code and tables are named rather than read out.
 */
export function ReadAloudButton({ text, className }: { text: string; className?: string }) {
  const [id] = useState(() => Symbol('reply'));
  const active = useReading(id);
  // Leaving the conversation stops its reply.
  useEffect(() => () => stopReading(id), [id]);
  if (!speechSupported()) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      aria-pressed={active}
      onClick={() => {
        if (active) return stopReading(id);
        trackAction('read_aloud');
        readAloud(id, text);
      }}
    >
      {active ? <Square size={12} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
      {active ? 'Stop' : 'Read aloud'}
    </Button>
  );
}
