import { ArrowRight, Check, Copy } from 'lucide-react';
import { type FormEvent, useId, useRef, useState } from 'react';
import { accessMessage, accessRequest } from './access-api';

const groups = [
  {
    name: 'platforms',
    title: 'Where do you build?',
    options: [
      ['macos', 'macOS'],
      ['windows', 'Windows'],
      ['linux', 'Linux'],
    ],
  },
  {
    name: 'agents',
    title: 'Which agents do you use or want to try?',
    options: [
      ['codex', 'Codex'],
      ['claude', 'Claude Code'],
      ['opencode', 'OpenCode'],
      ['grok', 'Grok'],
      ['antigravity', 'Antigravity'],
      ['cursor', 'Cursor'],
      ['gemini', 'Gemini CLI'],
      ['other', 'Other'],
      ['exploring', 'Still exploring'],
    ],
  },
  {
    name: 'priorities',
    title: 'What would help you most?',
    options: [
      ['parallel', 'Parallel tasks'],
      ['review', 'Reviewing changes'],
      ['context', 'Project memory'],
      ['accounts', 'Accounts & usage'],
      ['recurring', 'Recurring work'],
      ['remote', 'Remote access'],
    ],
  },
];

export type Preferences = { platforms: string[]; agents: string[]; priorities: string[] };

/**
 * The same three questions, for a member who is already signed in.
 *
 * The signup version rides a one-time capability token that expires, so anyone
 * who skipped it there could never answer. This one posts against the waitlist
 * session, prefills what they said before, and lets them change their mind.
 */
export function WaitlistQuestions({
  answers,
  onSaved,
}: {
  answers: Preferences | null;
  onSaved: (next: Preferences) => void;
}) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'saving'>('idle');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(!answers);
  const pending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setState('saving');
    setMessage('');
    const data = new FormData(event.currentTarget);
    const preferences = Object.fromEntries(
      groups.map(({ name }) => [name, data.getAll(name) as string[]]),
    ) as unknown as Preferences;
    try {
      await accessRequest('waitlist/preferences', { preferences });
      onSaved(preferences);
      setOpen(false);
      setMessage('Saved. Thanks — this is what we plan against.');
    } catch (error) {
      setMessage(accessMessage(error));
    } finally {
      setState('idle');
      pending.current = false;
    }
  }

  const chosen = (name: string) => (answers?.[name as keyof Preferences] ?? []) as string[];
  const answered = groups.flatMap((group) => chosen(group.name)).length;

  return (
    <section className="access-card waitlist-questions" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Help us decide what to build next.</h2>
      <p>
        Three optional questions. Windows is furthest along — if you are on macOS or Linux, saying so
        is the most useful thing you can do right now.
      </p>
      {!open ? (
        <div className="preference-actions">
          <p className="access-fine">
            You answered {answered} {answered === 1 ? 'option' : 'options'}. You can change them any
            time.
          </p>
          <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>
            Update my answers
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          {groups.map((group) => (
            <fieldset key={group.name} disabled={state === 'saving'}>
              <legend>{group.title}</legend>
              <div className="preference-options">
                {group.options.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      name={group.name}
                      value={value}
                      defaultChecked={chosen(group.name).includes(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="preference-actions">
            <button type="submit" className="button button-primary" disabled={state === 'saving'}>
              {state === 'saving' ? 'Saving…' : 'Save my answers'} <Check size={16} />
            </button>
            {answers && (
              <button
                type="button"
                className="text-link"
                disabled={state === 'saving'}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

export function WaitlistPreferences({ token }: { token: string }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'skipped'>('idle');
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setState('saving');
    setMessage('');
    const data = new FormData(event.currentTarget);
    const preferences = Object.fromEntries(groups.map(({ name }) => [name, data.getAll(name)]));
    try {
      await accessRequest('preferences', { token, preferences });
      setState('done');
    } catch (error) {
      setState('idle');
      setMessage(accessMessage(error));
    } finally {
      pending.current = false;
    }
  }
  const shareUrl = 'https://jackalope.dev/';
  return (
    <section className="waitlist-preferences" aria-labelledby={`${id}-title`}>
      {state === 'done' || state === 'skipped' ? (
        <>
          <h3 id={`${id}-title`}>
            {state === 'done' ? 'Thanks. Help shape what comes next.' : 'You’re all set.'}
          </h3>
          <p>
            {state === 'done'
              ? 'Your preferences will help us prioritize platforms, agents, and workflows.'
              : 'Check your email to verify your place and unlock your referral link.'}
          </p>
          <a href="/tour/" className="button button-primary">
            Explore the app <ArrowRight size={16} />
          </a>
          <button
            type="button"
            className="button button-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl);
                setMessage('Waitlist link copied.');
              } catch {
                setMessage('Could not copy. You can share jackalope.dev directly.');
              }
            }}
          >
            <Copy size={16} /> Copy public website link
          </button>
          <a className="button button-secondary" href="/waitlist/">
            See my waitlist place <ArrowRight size={16} />
          </a>
          <p className="signup-consent">
            Use your personal link from your waitlist page to earn referral priority. Once accepted,
            you get five Instant Access Passes to bring people straight in.
          </p>
        </>
      ) : (
        <form onSubmit={submit}>
          <h3 id={`${id}-title`}>Make Jackalope fit your work.</h3>
          <p>Optional · Pick all that apply. Your place is already saved.</p>
          {groups.map((group) => (
            <fieldset key={group.name} disabled={state === 'saving'}>
              <legend>{group.title}</legend>
              <div className="preference-options">
                {group.options.map(([value, label]) => (
                  <label key={value}>
                    <input type="checkbox" name={group.name} value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="signup-consent">
            Tell us what you use today. See <a href="/agents/">current agent support</a> and our{' '}
            <a href="/roadmap/">roadmap</a>. Answers are saved with new signups; existing
            preferences stay unchanged. <a href="/privacy/#access">Privacy</a>.
          </p>
          <div className="preference-actions">
            <button type="submit" className="button button-primary" disabled={state === 'saving'}>
              {state === 'saving' ? 'Saving…' : 'Save preferences'} <Check size={16} />
            </button>
            <button
              type="button"
              className="text-link"
              disabled={state === 'saving'}
              onClick={() => {
                setMessage('');
                setState('skipped');
              }}
            >
              Skip for now
            </button>
          </div>
        </form>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

export function signupCampaign() {
  const params = new URLSearchParams(window.location.search);
  const result: Record<string, string> = {};
  for (const key of ['source', 'medium', 'campaign']) {
    const value = params.get(`utm_${key}`);
    if (value && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)) result[key] = value;
  }
  const path = window.location.pathname;
  const current = { ...result, landing: /^\/[a-zA-Z0-9/_-]{0,179}$/.test(path) ? path : '/' };
  try {
    const saved = JSON.parse(sessionStorage.getItem('jackalope-signup-source') || 'null');
    if (
      !Object.keys(result).length &&
      saved &&
      typeof saved === 'object' &&
      typeof saved.landing === 'string' &&
      /^\/[a-zA-Z0-9/_-]{0,179}$/.test(saved.landing) &&
      Object.entries(saved).every(
        ([key, value]) =>
          key === 'landing' ||
          (['source', 'medium', 'campaign'].includes(key) &&
            typeof value === 'string' &&
            /^[a-zA-Z0-9_.-]{1,80}$/.test(value)),
      )
    )
      return saved;
    sessionStorage.setItem('jackalope-signup-source', JSON.stringify(current));
  } catch {}
  return current;
}
