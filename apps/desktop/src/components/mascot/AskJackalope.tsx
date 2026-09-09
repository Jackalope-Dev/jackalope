import { BookOpen, Send, Square } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useHelperStore } from '../../stores/helperStore';
import { Button } from '../ui/button';
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
  const [connection, setConnection] = useState<{ url: string; token: string }>();
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const working = helper.sending || helper.view.turns.some((turn) => turn.status === 'working');
  const native = isTauriEnvironment();
  useEffect(() => {
    if (!helper.view.connected) setConnection(undefined);
  }, [helper.view.connected]);
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
        <div className="helper-intro">
          <p>Ask about Jackalope, personalize your workspace, or prepare your next task.</p>
          <small>
            {agent ? `Uses ${agent} and its active account.` : 'Choose a default agent in Agents.'}{' '}
            Messages and shared context go to that provider and may count toward its usage limits.
          </small>
        </div>
        <details className="helper-context">
          <summary>Context & connections</summary>
          <p>
            App version, current page and agent availability are shared. Project files, paths, task
            messages and credentials are excluded.
          </p>
          <label>
            <input
              type="checkbox"
              checked={helper.sharePreferences}
              onChange={(event) => {
                useHelperStore.setState({ sharePreferences: event.target.checked });
                void helper.refresh();
              }}
            />{' '}
            Appearance and supported preferences
          </label>
          <label>
            <input
              type="checkbox"
              checked={helper.shareProjects}
              onChange={(event) => {
                useHelperStore.setState({ shareProjects: event.target.checked });
                void helper.refresh();
              }}
            />{' '}
            Project names and selected project task statuses
          </label>
          <p>
            Each question includes up to eight previous replies. Earlier shared information can
            remain in the conversation; start a new conversation to omit it.
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={!native}
            onClick={() =>
              void action(async () => {
                if (helper.view.connected) {
                  await nativeTask('helper_connection', { enabled: false });
                  setConnection(undefined);
                } else setConnection(await nativeTask('helper_connection', { enabled: true }));
                setCopied(false);
              })
            }
          >
            {helper.view.connected ? 'Disconnect external agent' : 'Connect an external agent'}
          </Button>
          {helper.view.connected && (
            <p>
              Local MCP access expires after one hour or when Jackalope closes. Connected agents can
              read the context selected above and propose actions for review here.
            </p>
          )}
          {helper.view.connected && !connection && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void action(async () => {
                  setConnection(await nativeTask('helper_connection', { enabled: true }));
                  setCopied(false);
                })
              }
            >
              Replace connection to copy again
            </Button>
          )}
          {connection && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(
                    JSON.stringify(
                      {
                        mcpServers: {
                          jackalope: {
                            type: 'http',
                            url: connection.url,
                            headers: { Authorization: `Bearer ${connection.token}` },
                          },
                        },
                      },
                      null,
                      2,
                    ),
                  );
                  setCopied(true);
                })
              }
            >
              {copied ? 'Connection copied' : 'Copy MCP connection'}
            </Button>
          )}
          <button
            type="button"
            className="helper-text-button"
            onClick={() =>
              void openLink('https://jackalope.dev/knowledge/ask-jackalope/').catch((error) =>
                setLocalError(String(error)),
              )
            }
          >
            Connection instructions
          </button>
        </details>
        <div className="helper-transcript">
          {!count && (
            <div className="helper-suggestions">
              {[
                'How do isolated worktrees work?',
                'Make Jackalope dark with a purple accent.',
                'What can you help me do?',
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    useHelperStore.setState({ draft: prompt });
                    input.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
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
          <p role="alert" className="helper-error">
            {localError || helper.error || helper.syncError || helper.view.error}
          </p>
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
        <textarea
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
          <button
            className="helper-text-button"
            type="button"
            onClick={() =>
              void openLink('https://jackalope.dev/knowledge/').catch((error) =>
                setLocalError(String(error)),
              )
            }
          >
            <BookOpen size={14} /> Browse help
          </button>
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
              <Send size={14} /> Send
            </Button>
          )}
        </div>
        {!!count && (
          <button
            type="button"
            className="helper-text-button"
            disabled={working}
            onClick={() => void action(() => nativeTask('helper_new_conversation'))}
          >
            New conversation · archive this one locally
          </button>
        )}
      </form>
    </section>
  );
}
