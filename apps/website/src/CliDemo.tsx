import { ArrowRight, RotateCcw, SquareTerminal } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import './cli-demo.css';

const prompt = 'Add a dark mode toggle to the settings page';
const answer = 'Per device';

// Each line appears at its step. The glyphs and wording follow the real
// `jackalope` terminal interface: Braille marks, `›` for sent messages and a
// status line that names the agent and why it was chosen.
const script: { at: number; line: ReactNode; className?: string }[] = [
  {
    at: 2,
    className: 'cli-demo-status',
    line: (
      <>
        <span className="cli-demo-accent">⣾ routing</span> · choosing an agent for this project
      </>
    ),
  },
  {
    at: 3,
    className: 'cli-demo-status',
    line: (
      <>
        <span className="cli-demo-accent">⣽ running</span> · Claude Code · feature/dark-mode ·
        strongest recent UI results here
      </>
    ),
  },
  {
    at: 4,
    line: (
      <>
        <span className="cli-demo-accent">•</span> Reading{' '}
        <code>src/settings/SettingsPage.tsx</code>
      </>
    ),
  },
  {
    at: 5,
    line: (
      <>
        <span className="cli-demo-accent">•</span> Editing <code>src/theme/useTheme.ts</code> and 2
        more
      </>
    ),
  },
  {
    at: 6,
    className: 'cli-demo-question',
    line: (
      <>
        <span className="cli-demo-accent">⠿ Claude Code needs you</span>
        <br />
        Remember the choice per device or per account?
        <br />
        <span className="cli-demo-accent">⣿</span> <strong>Per device</strong>
        <span className="cli-demo-muted"> keeps it local</span>
        <br />
        {'  '}Per account<span className="cli-demo-muted"> syncs everywhere</span>
      </>
    ),
  },
  {
    at: 7,
    className: 'cli-demo-sent',
    line: <>› {answer}</>,
  },
  {
    at: 8,
    line: (
      <>
        <span className="cli-demo-accent">•</span> Running <code>pnpm test</code> ·{' '}
        <span className="cli-demo-ok">42 passed</span>
      </>
    ),
  },
  {
    at: 9,
    className: 'cli-demo-status',
    line: (
      <>
        <span className="cli-demo-accent">⣿ ready for review</span> · 3 files changed · checks
        passed · <span className="cli-demo-accent">/diff</span> to review and commit
      </>
    ),
  },
];
const lastStep = 9;

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function CliDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  // 0 until the terminal scrolls into view; each replay starts a new run.
  const [run, setRun] = useState(0);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRun((value) => value || 1);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (run === 0) return;
    if (prefersReducedMotion()) {
      setTyped(prompt.length);
      setStep(lastStep);
      return;
    }
    setStep(0);
    setTyped(0);
    const timers: number[] = [];
    for (let index = 1; index <= prompt.length; index++)
      timers.push(window.setTimeout(() => setTyped(index), 400 + index * 38));
    const typedAt = 400 + prompt.length * 38;
    const delays = [0, 350, 1100, 2300, 3300, 4300, 5500, 7300, 8300, 9600];
    delays.forEach((delay, index) => {
      if (index > 0) timers.push(window.setTimeout(() => setStep(index), typedAt + delay));
    });
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [run]);

  // Like a real terminal, keep the newest line in view as the session grows.
  useEffect(() => {
    const element = screen.current;
    if (element) element.scrollTop = step === 0 ? 0 : element.scrollHeight;
  }, [step]);

  const done = step >= lastStep;
  return (
    <section
      className="landing-width cli-demo-section"
      id="terminal"
      aria-labelledby="terminal-title"
      data-reveal=""
    >
      <div className="cli-demo-copy">
        <p className="cli-demo-eyebrow">
          <SquareTerminal size={17} aria-hidden="true" /> The jackalope command
        </p>
        <h2 id="terminal-title">
          Prefer the terminal?
          <br />
          <span>Just say what you need.</span>
        </h2>
        <p>
          Type <code>jackalope</code> in any repository and start chatting. Jackalope routes the
          conversation to an agent, shows what it’s doing and why it was chosen, and asks when it
          needs you. It installs with the app on macOS, Windows and Linux.
        </p>
        <ul>
          <li>Several conversations at once, each in its own terminal.</li>
          <li>Open it from the app’s status bar, then carry it into your own terminal.</li>
          <li>
            Slash commands like <code>/agents</code>, <code>/sessions</code> and <code>/diff</code>.
          </li>
        </ul>
        <a className="text-link" href="/knowledge/terminal-command/">
          Get to know the command <ArrowRight size={15} aria-hidden="true" />
        </a>
      </div>

      <figure className="cli-demo-figure">
        <div className="cli-demo-window" ref={frame}>
          <div className="cli-demo-titlebar" aria-hidden="true">
            <span />
            <span />
            <span />
            <strong>~/code/storefront — jackalope</strong>
          </div>
          <div
            className="cli-demo-screen"
            ref={screen}
            role="img"
            aria-label={`Illustrated terminal session: the prompt "${prompt}" is routed to Claude Code, which edits three files, asks whether to remember the choice per device, runs 42 passing tests and is ready for review.`}
          >
            <div aria-hidden="true">
              <pre className="cli-demo-banner">
                <span className="cli-demo-echo" style={{ opacity: 0.18 }}>
                  jackalope
                </span>
                <span className="cli-demo-echo" style={{ opacity: 0.36 }}>
                  jackalope
                </span>
                <span className="cli-demo-echo" style={{ opacity: 0.6 }}>
                  jackalope
                </span>
                <strong>jackalope</strong>
              </pre>
              <p className="cli-demo-muted">
                storefront <span className="cli-demo-accent">main</span> · ~/code/storefront
              </p>
              <p className="cli-demo-muted cli-demo-rule">{'⠒'.repeat(80)}</p>
              <p className="cli-demo-sent">
                {typed > 0 && '› '}
                {prompt.slice(0, typed)}
                {step === 0 && <span className="cli-demo-cursor" />}
              </p>
              {script.map(
                (item) =>
                  step >= item.at && (
                    <p key={item.at} className={`cli-demo-line ${item.className ?? ''}`}>
                      {item.line}
                    </p>
                  ),
              )}
              {step >= 1 && !done && (
                <p className="cli-demo-input">
                  <span className="cli-demo-cursor" />
                </p>
              )}
              <p className="cli-demo-muted cli-demo-keys">
                <span className="cli-demo-accent">/</span> commands{'   '}
                <span className="cli-demo-accent">/sessions</span> switch{'   '}
                <span className="cli-demo-accent">Ctrl+C</span> leave
              </p>
            </div>
          </div>
        </div>
        <figcaption>
          <span>Illustrated session</span>
          <button
            type="button"
            className="landing-text-button"
            onClick={() => setRun((value) => value + 1)}
            disabled={!done}
          >
            <RotateCcw size={15} aria-hidden="true" /> Replay
          </button>
        </figcaption>
      </figure>
    </section>
  );
}
