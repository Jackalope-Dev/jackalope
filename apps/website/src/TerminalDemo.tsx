import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import './terminal-demo.css';

/*
 * A browser imitation of the `jackalope` terminal UI with scripted data. Layout, glyphs,
 * copy and command names follow apps/desktop/src-tauri/src/cli/ui/render; keep them in step
 * when the terminal changes. Every reply, shell result and agent here is canned.
 */

type Line =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; agent: string; text: string }
  | { kind: 'question'; text: string; options: string[] }
  | { kind: 'run'; command: string; output: string[] }
  | { kind: 'note'; text: string };

type Session = {
  id: number;
  title: string;
  agent: string;
  state: 'idle' | 'working' | 'asking' | 'done';
  activity: string[];
  started: number;
  changes: number;
  lines: Line[];
};

type Mention = { agent: string } | { file: string };
type Popup =
  | { kind: 'commands'; items: [string, string][] }
  | { kind: 'mentions'; items: Mention[]; start: number }
  | { kind: 'agents'; items: string[] }
  | { kind: 'sessions'; items: Session[] }
  | { kind: 'answer'; items: string[] };

const SPINNER = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
const AGENTS = ['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode', 'Kimi Code'];
const FILES = [
  'src/settings/Page.tsx',
  'src/theme/useTheme.ts',
  'src/cart/total.ts',
  'src/cart/total.test.ts',
  'src/search/index.ts',
  'README.md',
  'AGENTS.md',
  'package.json',
];
const COMMANDS: [string, string][] = [
  ['new', 'start a fresh conversation, optionally with a message'],
  ['bg', 'start another conversation and stay on this one'],
  ['init', 'write or refresh AGENTS.md for this repository'],
  ['sessions', 'switch to any open conversation'],
  ['agents', 'see which agents are ready'],
  ['status', 'show the project, host and agents'],
  ['agent', 'choose the agent for your next conversation'],
  ['usage', 'show account quota and when it resets'],
  ['learn', 'save learnings from this session to project context'],
  ['files', 'show or hide the files this work changed (Ctrl+O)'],
  ['review', "open this work's changes in the app to review and commit"],
  ['stop', 'stop the work that is running'],
  ['retry', 'run the last message again'],
  ['answer', "choose an answer to the agent's question"],
  ['help', 'show these commands'],
];
const INTRO = 'add a dark mode toggle to settings @src/settings/Page.tsx';
const SUGGESTIONS = ['/agent', '/bg fix the flaky cart test', '!git status', '@'];

// The wordmark from brand.rs: six pixel capitals, two pixels to a row of half blocks.
const LETTERS: Record<string, string[]> = {
  J: ['  ####', '    ##', '    ##', '    ##', '##  ##', ' #### '],
  A: [' #### ', '##  ##', '##  ##', '######', '##  ##', '##  ##'],
  C: [' #####', '##    ', '##    ', '##    ', '##    ', ' #####'],
  K: ['##  ##', '## ## ', '####  ', '####  ', '## ## ', '##  ##'],
  L: ['##    ', '##    ', '##    ', '##    ', '##    ', '######'],
  O: [' #### ', '##  ##', '##  ##', '##  ##', '##  ##', ' #### '],
  P: ['##### ', '##  ##', '##  ##', '##### ', '##    ', '##    '],
  E: ['######', '##    ', '##### ', '##    ', '##    ', '######'],
};
const WORDMARK = [0, 1, 2].map((cell) =>
  Array.from('JACKALOPE', (letter) =>
    Array.from(LETTERS[letter][0], (_, column) => {
      const top = LETTERS[letter][cell * 2][column] === '#';
      const bottom = LETTERS[letter][cell * 2 + 1][column] === '#';
      return top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }).join(''),
  ).join(' '),
);

function titleOf(text: string) {
  const words = text.replace(/@\S+/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
  return words ? words[0].toUpperCase() + words.slice(1) : 'New conversation';
}

const blank = (id: number, agent: string): Session => ({
  id,
  title: 'New conversation',
  agent,
  state: 'idle',
  activity: [],
  started: 0,
  changes: 0,
  lines: [],
});

function fresh(): Session[] {
  return [
    blank(1, 'Claude Code'),
    {
      ...blank(2, 'Codex'),
      title: 'Release notes',
      state: 'working',
      started: Date.now(),
      activity: ['reading 14 commits since 0.1', 'grouping changes by area'],
      lines: [{ kind: 'user', text: 'write the release notes for 0.2' }],
    },
  ];
}

/** Where the scripted introduction ends; also what server output and reduced motion show. */
function introduced(): Session[] {
  const [first, second] = fresh();
  return [
    {
      ...first,
      title: 'Dark mode toggle',
      state: 'asking',
      lines: [
        { kind: 'user', text: INTRO },
        {
          kind: 'agent',
          agent: 'Claude Code',
          text: 'Settings already has an Appearance group, so the toggle goes there. `useTheme` follows the system setting today.',
        },
        {
          kind: 'question',
          text: 'Remember the choice per device or per account?',
          options: ['per device', 'per account'],
        },
      ],
    },
    {
      ...second,
      state: 'done',
      activity: [],
      changes: 1,
      lines: [
        ...second.lines,
        {
          kind: 'agent',
          agent: 'Codex',
          text: 'Drafted the 0.2 notes from 14 commits in `RELEASES.md`: three highlights and two fixes.',
        },
      ],
    },
  ];
}

/** What an agent does with a message: progress lines, a reply and files changed. */
function plan(text: string): { activity: string[]; reply: string; changes: number } {
  const lower = text.toLowerCase();
  if (/per (device|account)|^[12]$/.test(lower)) {
    const scope = lower.includes('device') || lower === '1' ? 'device' : 'account';
    return {
      activity: ['editing src/theme/useTheme.ts', `storing the choice per ${scope}`, 'pnpm test'],
      reply: `Done. The toggle sits in Settings › Appearance and is remembered per ${scope}. 3 files changed and the checks pass. \`/review\` opens it in the app.`,
      changes: 3,
    };
  }
  if (lower.includes('test')) {
    return {
      activity: [
        'pnpm test src/cart',
        'reading src/cart/total.test.ts',
        'editing src/cart/total.ts',
      ],
      reply:
        'The cart total rounded each line before summing. It now adds integer cents. All 48 tests pass, five runs in a row.',
      changes: 2,
    };
  }
  if (/readme|docs|notes/.test(lower)) {
    return {
      activity: ['reading recent commits', 'editing README.md'],
      reply: 'Updated `README.md` with the new setup steps and a short troubleshooting section.',
      changes: 1,
    };
  }
  const files = 2 + (text.length % 3);
  return {
    activity: ['reading the project', `editing ${files} files`, 'pnpm test'],
    reply: `Done in its own worktree: ${files} files changed and the checks pass. Reply to ask for another pass, or \`/review\` to open it in the app.`,
    changes: files,
  };
}

const SHELL: Record<string, string[]> = {
  'git status': ['On branch main', 'nothing to commit, working tree clean'],
  ls: ['AGENTS.md  README.md  package.json  src'],
  'pnpm test': ['✓ 48 tests passed (1.9s)'],
  'git log --oneline -3': [
    'a41f2c0 Add keyboard search',
    '9b0e1d7 Fix lost drafts',
    '3c22a9e Simplify nav',
  ],
};

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|@\S+)/).map((part, index) => {
        const key = `${index}${part}`;
        if (part.startsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
        if (part.startsWith('@')) return <b key={key}>{part}</b>;
        return part;
      })}
    </>
  );
}

function Welcome({ sessions, agent }: { sessions: Session[]; agent: string }) {
  const waiting = sessions.filter((item) => item.state === 'asking').length;
  return (
    <div className="td-welcome">
      <span className="td-sr">jackalope</span>
      <pre className="td-wordmark" aria-hidden="true">
        {WORDMARK.join('\n')}
      </pre>
      <p className="td-muted">your coding agents, orchestrated</p>
      <p className="td-chips">
        {AGENTS.map((name) => (
          <span key={name} className="td-chip" data-tone={name === agent ? 'accent' : 'success'}>
            ● {name}
          </span>
        ))}
      </p>
      <p>
        <span className="td-muted">{sessions.length} open here</span>
        {waiting > 0 && (
          <>
            {'  '}
            <span className="td-chip" data-tone="warning">
              {` ${waiting} need you `}
            </span>
          </>
        )}
        <span className="td-muted">{'  /sessions'}</span>
      </p>
    </div>
  );
}

export function TerminalDemo() {
  const [sessions, setSessions] = useState<Session[]>(introduced);
  const [current, setCurrent] = useState(1);
  const [input, setInput] = useState('');
  const [popup, setPopup] = useState<Popup | null>(null);
  const [choice, setChoice] = useState(0);
  const [tick, setTick] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const nextId = useRef(3);
  const escapes = useRef(0);

  const later = useCallback((delay: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, delay));
  }, []);
  const update = useCallback((id: number, change: (session: Session) => Session) => {
    setSessions((all) => all.map((session) => (session.id === id ? change(session) : session)));
  }, []);
  const append = useCallback(
    (id: number, ...lines: Line[]) =>
      update(id, (session) => ({ ...session, lines: [...session.lines, ...lines] })),
    [update],
  );

  /** Sends `text` to session `id` and plays the agent's scripted work. */
  const work = useCallback(
    (id: number, text: string) => {
      const steps = plan(text);
      const named = AGENTS.find((agent) => text.startsWith(`@${agent}`));
      update(id, (session) => ({
        ...session,
        agent: named ?? session.agent,
        title: session.title === 'New conversation' ? titleOf(text) : session.title,
        state: 'working',
        started: Date.now(),
        activity: [steps.activity[0]],
        lines: [...session.lines, { kind: 'user', text }],
      }));
      steps.activity.slice(1).forEach((step, index) => {
        later(900 + index * 900, () =>
          update(id, (session) => ({ ...session, activity: [...session.activity, step] })),
        );
      });
      later(900 * steps.activity.length, () =>
        update(id, (session) =>
          session.state === 'working'
            ? {
                ...session,
                state: 'done',
                activity: [],
                changes: session.changes + steps.changes,
                lines: [
                  ...session.lines,
                  { kind: 'agent', agent: session.agent, text: steps.reply },
                ],
              }
            : session,
        ),
      );
    },
    [later, update],
  );

  // Plays the introduction once, the first time the terminal scrolls into view.
  useEffect(() => {
    const element = root.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight) return;
    setSessions(fresh());
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        Array.from(INTRO).forEach((_, index) => {
          later(1200 + index * 38, () => setInput(INTRO.slice(0, index + 1)));
        });
        const sent = 1200 + INTRO.length * 38 + 500;
        later(sent, () => {
          setInput('');
          update(1, (session) => ({
            ...session,
            title: 'Dark mode toggle',
            state: 'working',
            started: Date.now(),
            activity: ['reading src/settings/Page.tsx'],
            lines: [{ kind: 'user', text: INTRO }],
          }));
        });
        later(sent + 1100, () =>
          update(1, (session) => ({
            ...session,
            activity: [...session.activity, 'reading src/theme/useTheme.ts'],
          })),
        );
        later(sent + 1700, () => update(2, () => introduced()[1]));
        later(sent + 2600, () => update(1, () => introduced()[0]));
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [later, update]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  const busy = sessions.some((session) => session.state === 'working');
  useEffect(() => {
    if (!busy || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 90);
    return () => window.clearInterval(timer);
  }, [busy]);

  const session = sessions.find((item) => item.id === current) ?? sessions[0];
  const asked = [...session.lines].reverse().find((line) => line.kind === 'question');
  const question = session.state === 'asking' && asked?.kind === 'question' ? asked : undefined;
  const lineCount = session.lines.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when lines or activity change.
  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lineCount, session.activity.length, current]);

  // The menu follows the draft: commands after a leading slash, agents and files after an @.
  const typed = (value: string) => {
    setInput(value);
    setChoice(0);
    const mention = /(^|\s)@(\S*)$/.exec(value);
    if (/^\/\S*$/.test(value)) {
      const items = COMMANDS.filter(([name]) => name.startsWith(value.slice(1)));
      setPopup(items.length ? { kind: 'commands', items } : null);
    } else if (mention) {
      const query = mention[2].toLowerCase();
      const fuzzy = (text: string) => {
        let at = 0;
        for (const char of text.toLowerCase()) if (char === query[at]) at++;
        return at === query.length;
      };
      const items: Mention[] = [
        ...AGENTS.filter(fuzzy).map((agent) => ({ agent })),
        ...FILES.filter(fuzzy).map((file) => ({ file })),
      ].slice(0, 8);
      setPopup(
        items.length
          ? { kind: 'mentions', items, start: value.length - mention[2].length - 1 }
          : null,
      );
    } else if (popup?.kind === 'commands' || popup?.kind === 'mentions') {
      setPopup(null);
    }
  };

  const switchTo = (index: number) => {
    const target = sessions[index];
    if (!target) return;
    setCurrent(target.id);
    setPopup(null);
    if (target.state === 'done') update(target.id, (item) => ({ ...item, state: 'idle' }));
  };

  const command = (line: string) => {
    const [name, ...rest] = line.slice(1).split(' ');
    const argument = rest.join(' ').trim();
    const note = (...texts: string[]) =>
      append(current, ...texts.map((text) => ({ kind: 'note' as const, text })));
    switch (name) {
      case 'new': {
        const id = nextId.current++;
        setSessions((all) => [...all, blank(id, session.agent)]);
        setCurrent(id);
        if (argument) later(50, () => work(id, argument));
        return;
      }
      case 'bg': {
        if (!argument) return note('Say what to start: /bg fix the flaky test');
        const id = nextId.current++;
        setSessions((all) => [...all, { ...blank(id, session.agent), title: titleOf(argument) }]);
        later(50, () => work(id, argument));
        return note(
          `Started “${titleOf(argument)}” in the background. Alt+${sessions.length + 1} to switch.`,
        );
      }
      case 'sessions':
        setChoice(0);
        return setPopup({ kind: 'sessions', items: sessions });
      case 'agent':
        setChoice(0);
        return setPopup({ kind: 'agents', items: AGENTS });
      case 'answer':
        if (!question) return note('Nothing is waiting on an answer.');
        setChoice(0);
        return setPopup({ kind: 'answer', items: question.options });
      case 'agents':
        return note(...AGENTS.map((agent) => `● ${agent}  ready`));
      case 'status':
        return note(
          'project  storefront  ⎇ main',
          'host     Jackalope desktop · connected',
          `agent    ${session.agent} · ${sessions.length} conversations open`,
        );
      case 'usage':
        return note(`${session.agent}  41% of the weekly limit used · resets Thursday 09:00`);
      case 'learn':
        return note(
          'Saved 2 lessons to project context',
          '  Theme state lives in src/theme/useTheme.ts',
          '  Run pnpm test before handing work back',
        );
      case 'init':
        return note('Wrote AGENTS.md: 6 sections, 42 lines.');
      case 'files':
        return note(
          session.changes
            ? `${session.changes} files changed: src/theme/useTheme.ts, src/settings/Page.tsx…`
            : 'No changes yet.',
        );
      case 'review':
        return note('Opens the changes in the Jackalope app. This demo has no app attached.');
      case 'retry': {
        const last = [...session.lines].reverse().find((item) => item.kind === 'user');
        return last?.kind === 'user' ? work(current, last.text) : note('Nothing to retry.');
      }
      case 'stop':
        if (session.state !== 'working') return note('Nothing is running.');
        update(current, (item) => ({ ...item, state: 'idle', activity: [] }));
        return note('Stopped.');
      case 'help':
        return note(
          ...COMMANDS.map(([command, about]) => `/${command.padEnd(10)}${about}`),
          `${'!<command>'.padEnd(11)}run a shell command in this workspace`,
          `${'@<file>'.padEnd(11)}mention a file (Tab inserts)`,
          '  Alt+1–9 switch tabs · Esc Esc stop the agent',
        );
      default:
        return note(`Unknown command /${name}. Type / to see them all.`);
    }
  };

  const submit = (value = input) => {
    const text = value.trim();
    setInput('');
    setPopup(null);
    if (!text) return;
    if (text.startsWith('/')) return command(text);
    if (text.startsWith('!')) {
      const shell = text.slice(1).trim();
      return append(current, {
        kind: 'run',
        command: shell,
        output: SHELL[shell] ?? [
          'This demo simulates the shell. Try !git status, !ls or !pnpm test.',
        ],
      });
    }
    work(current, text);
  };

  const accept = () => {
    if (!popup) return false;
    if (popup.kind === 'commands') {
      const [name] = popup.items[choice] ?? popup.items[0];
      if (input === `/${name}`) return false;
      typed(`/${name} `);
      setPopup(null);
      return true;
    }
    if (popup.kind === 'mentions') {
      const item = popup.items[choice];
      typed(`${input.slice(0, popup.start)}@${'agent' in item ? item.agent : item.file} `);
      setPopup(null);
      return true;
    }
    if (popup.kind === 'agents') {
      const agent = popup.items[choice];
      update(current, (item) => ({ ...item, agent }));
      append(current, { kind: 'note', text: `Next conversation uses ${agent}.` });
    } else if (popup.kind === 'answer') {
      submit(popup.items[choice]);
    } else {
      switchTo(choice);
    }
    setPopup(null);
    return true;
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = popup?.items.length ?? 0;
    if (event.altKey && /^Digit[1-9]$/.test(event.code)) {
      event.preventDefault();
      switchTo(Number(event.code.slice(5)) - 1);
    } else if (event.ctrlKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      command('/files');
    } else if (count && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setChoice((value) => (value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (event.key === 'Tab' && (popup?.kind === 'commands' || popup?.kind === 'mentions')) {
      event.preventDefault();
      accept();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!accept()) submit();
    } else if (event.key === 'Escape') {
      if (popup) setPopup(null);
      else if (input) setInput('');
      else if (session.state === 'working' && ++escapes.current >= 2) {
        escapes.current = 0;
        command('/stop');
      }
      return;
    }
    escapes.current = 0;
  };

  const suggest = (text: string) => {
    typed(text);
    field.current?.focus();
  };

  const spinner = SPINNER[tick % SPINNER.length];
  const working = session.state === 'working';
  const mode = input.startsWith('!')
    ? 'shell'
    : input.startsWith('/')
      ? 'command'
      : working && input
        ? 'queue'
        : '';
  const hint = {
    shell: 'shell · runs here, not sent to an agent',
    command: 'command',
    queue: 'queues after the current work',
    '': '',
  }[mode];
  const placeholder = question
    ? 'Type your answer'
    : working
      ? 'Queue a follow-up'
      : session.lines.length
        ? 'Reply'
        : 'What should we work on?';
  const elapsed = working
    ? `${Math.max(1, Math.round((Date.now() - session.started) / 1000))}s`
    : '';

  let body: ReactNode;
  if (!session.lines.length) {
    body = <Welcome sessions={sessions} agent={session.agent} />;
  } else {
    body = session.lines.map((line, index) => {
      const key = `${index}-${line.kind}`;
      switch (line.kind) {
        case 'user':
          return (
            <p className="td-user" key={key}>
              <Inline text={line.text} />
            </p>
          );
        case 'agent':
          return (
            <div className="td-block" key={key}>
              <p className="td-muted">
                <span className="td-accent">●</span> {line.agent}
              </p>
              <p>
                <Inline text={line.text} />
              </p>
            </div>
          );
        case 'question':
          return (
            <div className="td-block" key={key}>
              <p>
                <span className="td-warning">◆</span> <strong>{line.text}</strong>
              </p>
              <p className="td-muted">{`  ${line.options.join(' · ')}`}</p>
              <p className="td-muted">{'  Choose an answer, or type your own below.'}</p>
            </div>
          );
        case 'run':
          return (
            <div className="td-block" key={key}>
              <p>
                <span className="td-success">✓</span> <b>!{line.command}</b>
                <span className="td-muted">{'  ~/storefront'}</span>
              </p>
              {line.output.map((text) => (
                <p className="td-muted" key={text}>{`  │ ${text}`}</p>
              ))}
              <p className="td-muted">{'  └ exit 0 · 0.2s'}</p>
            </div>
          );
        default:
          return (
            <p className="td-note" key={key}>
              {line.text}
            </p>
          );
      }
    });
  }

  const menuTitle =
    popup?.kind === 'commands'
      ? '↑↓ choose · Tab complete · Enter run'
      : popup?.kind === 'mentions'
        ? '↑↓ choose · Tab or Enter insert · Esc close'
        : '↑↓ choose · Enter select · Esc close';

  return (
    <div className="td" ref={root}>
      <section className="td-window" aria-label="Interactive demo of the jackalope terminal">
        <header className="td-header">
          <span className="td-brand">◆ jackalope</span>
          <span className="td-tabs">
            {sessions.map((item, index) => {
              const tone =
                item.state === 'asking'
                  ? 'warning'
                  : item.state === 'working'
                    ? 'accent'
                    : item.state === 'done'
                      ? 'success'
                      : 'muted';
              const dot = item.state === 'working' ? spinner : item.state === 'idle' ? '○' : '●';
              return (
                <button
                  type="button"
                  key={item.id}
                  className="td-tab"
                  aria-current={item.id === current ? 'true' : undefined}
                  onClick={() => {
                    switchTo(index);
                    field.current?.focus();
                  }}
                >
                  {` ${index + 1} `}
                  <span data-tone={tone}>{dot}</span>
                  {` ${item.title} `}
                </button>
              );
            })}
          </span>
          <span className="td-header-right">
            <span>{session.agent}</span>
            <span className="td-muted">storefront</span>
            <span className="td-accent">⎇ main</span>
          </span>
        </header>
        <div className="td-card" data-working={working ? '' : undefined}>
          <div className="td-transcript" ref={transcript} aria-live="polite">
            {body}
            {working && session.activity.length > 0 && (
              <div className="td-block">
                {session.activity.slice(-6, -1).map((step) => (
                  <p className="td-muted" key={step}>{`  │ ${step}`}</p>
                ))}
                <p>
                  <span className="td-muted">{'  └ '}</span>
                  {session.activity.at(-1)}
                </p>
              </div>
            )}
          </div>
          {question && (
            <div className="td-question-card">
              <p>
                <strong className="td-warning">{' ? '}</strong>
                <strong>{question.text}</strong>
              </p>
              <p className="td-muted">
                {`  ${question.options.length} options · /answer to choose · or type your own`}
              </p>
            </div>
          )}
          <div className="td-input-wrap">
            {popup && (
              <div className="td-menu">
                <ul>
                  {popup.kind === 'commands' &&
                    popup.items.map(([name, about], index) => (
                      <li key={name} aria-current={index === choice ? 'true' : undefined}>
                        <span className="td-accent td-menu-name">/{name}</span>
                        <span className="td-menu-about">{about}</span>
                      </li>
                    ))}
                  {popup.kind === 'mentions' &&
                    popup.items.map((item, index) =>
                      'agent' in item ? (
                        <li key={item.agent} aria-current={index === choice ? 'true' : undefined}>
                          <span className="td-success td-menu-name">● {item.agent}</span>
                          <span className="td-menu-about">agent · starts the message with it</span>
                        </li>
                      ) : (
                        <li key={item.file} aria-current={index === choice ? 'true' : undefined}>
                          <span className="td-accent">{item.file.split('/').pop()}</span>
                          <span className="td-menu-about">
                            {item.file.includes('/')
                              ? `${item.file.slice(0, item.file.lastIndexOf('/'))}/`
                              : ''}
                          </span>
                        </li>
                      ),
                    )}
                  {(popup.kind === 'agents' || popup.kind === 'answer') &&
                    popup.items.map((item, index) => (
                      <li key={item} aria-current={index === choice ? 'true' : undefined}>
                        <span>{item}</span>
                      </li>
                    ))}
                  {popup.kind === 'sessions' &&
                    popup.items.map((item, index) => (
                      <li key={item.id} aria-current={index === choice ? 'true' : undefined}>
                        <span className="td-menu-name">
                          {index + 1} {item.title}
                        </span>
                        <span className="td-menu-about">{item.agent}</span>
                      </li>
                    ))}
                </ul>
                <span className="td-menu-title">{` ${menuTitle} `}</span>
              </div>
            )}
            <label className="td-input" data-mode={mode || undefined}>
              {hint && <span className="td-input-title">{` ${hint} `}</span>}
              <span className="td-prompt" aria-hidden="true">
                {mode === 'shell' ? '!' : mode === 'command' ? '/' : '❯'}
              </span>
              <span className="td-sr">Message the demo agent</span>
              <input
                ref={field}
                value={input}
                onChange={(event) => typed(event.target.value)}
                onKeyDown={keyDown}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>
        </div>
        <footer className="td-status">
          <span data-tone={working ? 'accent' : question ? 'warning' : 'success'}>
            {working ? spinner : '●'}{' '}
            <span className={working ? 'td-shimmer' : undefined}>
              {working ? 'Working' : question ? 'Waiting on your answer' : 'Ready'}
            </span>
          </span>
          <span className="td-muted td-details">
            {working && `  ${elapsed}  ${session.activity.at(-1) ?? ''}`}
            {!working && !session.lines.length && (
              <>
                {'  next with '}
                <span className="td-accent">{session.agent}</span>
              </>
            )}
            {!working && session.changes > 0 && `  ${session.changes} files changed`}
          </span>
          <span className="td-hints">
            {working && (
              <>
                <b>esc esc</b> stop{'   '}
              </>
            )}
            {session.changes > 0 && (
              <>
                <b>^O</b> files{'   '}
              </>
            )}
            <b>/</b> commands
            {!working && (
              <>
                {'   '}
                <b>!</b> shell{'   '}
                <b>@</b> mention
              </>
            )}
          </span>
        </footer>
      </section>
      <div className="td-try">
        <span>Try</span>
        {SUGGESTIONS.map((text) => (
          <button type="button" key={text} onClick={() => suggest(text)}>
            {text}
          </button>
        ))}
        <span>Alt+1–9 switches tabs.</span>
      </div>
    </div>
  );
}
