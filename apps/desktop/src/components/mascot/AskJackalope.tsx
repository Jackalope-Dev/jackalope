import { Textarea } from '@jackalope/ui';
import { Square } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useHelperStore } from '../../stores/helperStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { HelperAction } from './HelperAction';
import './helper.css';

const Markdown = lazy(() => import('../tasks/TaskMarkdown'));
async function openLink(url: string) {
  if (!/^https:\/\//i.test(url)) return;
  if (isTauriEnvironment()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

export function AskJackalope({ onNavigate }: { onNavigate: () => void }) {
  const helper = useHelperStore();
  const agent = useAgentConfigStore((state) => state.defaultMetaAgent);
  const [localError, setLocalError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const working = helper.sending || helper.view.turns.some((turn) => turn.status === 'working');
  const native = isTauriEnvironment();
  const count = helper.view.turns.length;
  useEffect(() => {
    if (count) scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [count]);
  const action = async (operation: () => Promise<unknown>) => {
    setLocalError('');
    try {
      await operation();
      await useHelperStore.getState().refresh();
    } catch (error) {
      setLocalError(String(error));
    }
  };
  return (
    <section className="helper-chat" aria-label="Ask Jackalope">
      <div className="helper-body" ref={scroll}>
        <div className="helper-transcript">
          {!count && <p className="helper-empty">How can I help?</p>}
          {helper.view.turns.map((turn) => (
            <article className="helper-turn" key={turn.id}>
              <p className="helper-user">{turn.prompt}</p>
              <small>
                {turn.agent} · {turn.account}
                {turn.model ? ` · ${turn.model}` : ''}
              </small>
              {!!turn.steps.length && (
                <details>
                  <summary>
                    {turn.steps.length} tool {turn.steps.length === 1 ? 'call' : 'calls'}
                  </summary>
                  <ul>
                    {[...new Set(turn.steps)].map((step) => (
                      <li key={step}>
                        {step.replaceAll('_', ' ')} ×{' '}
                        {turn.steps.filter((value) => value === step).length}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {turn.answer && (
                <Suspense fallback={<p>{turn.answer}</p>}>
                  <Markdown
                    content={turn.answer}
                    active={false}
                    onOpenLink={(url) =>
                      void openLink(url).catch((error) => setLocalError(String(error)))
                    }
                  />
                </Suspense>
              )}
              {turn.status === 'working' && <p role="status">Working with your agent…</p>}
              {turn.status === 'interrupted' && (
                <p role="status">
                  Interrupted when Jackalope closed. Send a follow-up to continue.
                </p>
              )}
              {turn.usage.reported && (
                <small>
                  {(turn.usage.input + turn.usage.output).toLocaleString()} reported input/output
                  tokens
                </small>
              )}
            </article>
          ))}
          {helper.view.actions.map((proposal) => (
            <HelperAction key={proposal.id} action={proposal} onNavigate={onNavigate} />
          ))}
        </div>
        {(localError || helper.error || helper.syncError || helper.view.error) && (
          <InlineNotice tone="error">
            {localError || helper.error || helper.syncError || helper.view.error}
          </InlineNotice>
        )}
      </div>
      <form
        className="helper-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void helper.send();
        }}
      >
        <label className="sr-only" htmlFor="helper-message">
          Message Jackalope
        </label>
        <Textarea
          ref={input}
          id="helper-message"
          value={helper.draft}
          maxLength={8000}
          rows={2}
          placeholder={native ? 'Ask Jackalope…' : 'Open the desktop app to use your agent'}
          disabled={!native}
          onChange={(event) => useHelperStore.setState({ draft: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!working) void helper.send();
            }
          }}
        />
        <div className="helper-buttons">
          {!!count && (
            <button
              type="button"
              className="helper-text-button"
              disabled={working}
              title="Archive this conversation locally and start a new one"
              onClick={() => void action(() => nativeTask('helper_new_conversation'))}
            >
              New conversation
            </button>
          )}
          {working ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void action(() => nativeTask('helper_stop'))}
            >
              <Square size={14} /> Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={!native || !helper.draft.trim() || !!helper.view.error}
            >
              Send
            </Button>
          )}
        </div>
        <small className="helper-disclaimer">
          {agent ? `Uses your default agent, ${agent}.` : 'Choose a default agent in Agents.'}{' '}
          Messages and shared context go to its provider. Usage limits apply.
        </small>
      </form>
    </section>
  );
}
