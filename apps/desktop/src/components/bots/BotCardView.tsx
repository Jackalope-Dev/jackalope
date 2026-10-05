import { Textarea } from '@jackalope/ui';
import {
  CircleHelp,
  ExternalLink,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  Newspaper,
} from 'lucide-react';
import { useState } from 'react';
import { answerCard, type BotCard, dismissCard } from '../../lib/bot-hub';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { useBotStore } from '../../stores/botStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { BotAvatar } from './BotAvatar';
import './bot-card.css';

const KINDS = {
  decision: { label: 'Decision', icon: ListChecks },
  input: { label: 'Needs input', icon: CircleHelp },
  action: { label: 'Suggested next step', icon: Lightbulb },
  sources: { label: 'Sources', icon: FileText },
  update: { label: 'Update', icon: Newspaper },
} as const;

/** A card a bot presented: its context, sources and the choices that answer it. */
export function BotCardView({
  card,
  showBot = false,
  onOpenConversation,
}: {
  card: BotCard;
  /** Lists outside the conversation name the bot that asked. */
  showBot?: boolean;
  onOpenConversation?: (sessionId: string) => void;
}) {
  const bot = useBotStore((state) => state.bots.find((item) => item.id === card.botId));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<number | 'text' | 'dismiss' | null>(null);
  const [error, setError] = useState('');
  const kind = KINDS[card.kind] ?? KINDS.update;
  const open = card.status === 'open';
  const act = async (key: number | 'text' | 'dismiss', action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await action();
      if (key === 'text') setText('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  };
  return (
    <article className="bot-card" data-kind={card.kind} data-status={card.status}>
      <header className="bot-card-header">
        {showBot ? (
          <BotAvatar appearance={bot?.appearance} agent={bot?.agent} />
        ) : (
          <kind.icon size={16} aria-hidden="true" />
        )}
        <span>
          <small>
            {kind.label}
            {showBot && ` · ${card.botName}`}
          </small>
          <strong>{card.title}</strong>
        </span>
      </header>
      {card.body && <p className="bot-card-body">{card.body}</p>}
      {card.sources.length > 0 && (
        <ul className="bot-card-sources" aria-label="Sources">
          {card.sources.map((source) => (
            <li key={`${source.title}:${source.url ?? source.path}`}>
              {source.url ? (
                <button
                  type="button"
                  className="bot-card-source"
                  onClick={() => void openExternalUrl(source.url ?? '')}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {source.title}
                </button>
              ) : (
                <span className="bot-card-source">
                  <FileText size={14} aria-hidden="true" />
                  {source.title}
                  <code>{source.path}</code>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && card.options.length > 0 && (
        <div className="bot-card-options">
          {card.options.map((option, index) => (
            <Button
              key={option.label}
              variant="outline"
              title={option.reply}
              disabled={busy !== null}
              loading={busy === index}
              loadingLabel="Sending…"
              onClick={() => void act(index, () => answerCard(card.id, index))}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
      {open && card.allowText && (
        <form
          className="bot-card-reply"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void act('text', () => answerCard(card.id, undefined, text));
          }}
        >
          <Textarea
            aria-label={`Answer ${card.botName}`}
            rows={2}
            maxLength={4000}
            value={text}
            placeholder="Write an answer…"
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            type="submit"
            disabled={!text.trim() || busy !== null}
            loading={busy === 'text'}
            loadingLabel="Sending…"
          >
            Send answer
          </Button>
        </form>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <footer className="bot-card-footer">
        {card.status === 'answered' && (
          <span>
            <MessageSquareText size={14} aria-hidden="true" />
            You answered: {card.answer}
          </span>
        )}
        {card.status === 'dismissed' && <span>Dismissed</span>}
        {onOpenConversation && (
          <Button variant="ghost" onClick={() => onOpenConversation(card.sessionId)}>
            Open conversation
          </Button>
        )}
        {open && (
          <Button
            variant="ghost"
            disabled={busy !== null}
            loading={busy === 'dismiss'}
            loadingLabel="Dismissing…"
            onClick={() => void act('dismiss', () => dismissCard(card.id))}
          >
            Dismiss
          </Button>
        )}
      </footer>
    </article>
  );
}
