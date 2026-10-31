import { AgentCharacter, type AgentGaze } from '@jackalope/brand/agent-character';
import { PROVIDER_MARKS } from '@jackalope/brand/provider-marks';
import { Disclosure, DisclosureSummary, GitHubIcon } from '@jackalope/ui';
import { ArrowDownToLine, ArrowRight, Check, Laptop, MousePointer2 } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
} from 'motion/react';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AsciiMark } from './AsciiMark';
import { GITHUB_URL } from './community';
import { TerminalDemo } from './TerminalDemo';
import './landing.css';

const REDUCED = '(prefers-reduced-motion: reduce)';
// Mirrors the CSS that pins the workspace; elsewhere the finished layout shows.
const PINNED =
  '(min-width: 1001px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)';
const EASE = [0.22, 1, 0.36, 1] as const;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Scroll position through a tall section, or 1 when the section is not pinned. */
function usePinnedProgress(target: RefObject<HTMLElement | null>) {
  const progress = useMotionValue(1);
  const [value, setValue] = useState(1);
  useMotionValueEvent(progress, 'change', (next) => setValue(Math.round(next * 300) / 300));
  const { scrollYProgress } = useScroll({ target, offset: ['start start', 'end end'] });
  useEffect(() => {
    const pinned = window.matchMedia(PINNED);
    let unsubscribe: (() => void) | undefined;
    const sync = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (!pinned.matches) {
        progress.set(1);
        return;
      }
      progress.set(scrollYProgress.get());
      unsubscribe = scrollYProgress.on('change', (next) => progress.set(next));
    };
    sync();
    pinned.addEventListener('change', sync);
    return () => {
      unsubscribe?.();
      pinned.removeEventListener('change', sync);
    };
  }, [progress, scrollYProgress]);
  return value;
}

/* Chapter: the work, in four beats */

const brief = 'Add keyboard search, fix the lost drafts, and try a simpler nav.';
const question = 'Keep drafts per document or per user?';
const answer = 'per document';

const agents = [
  {
    id: 'codex',
    name: 'Codex',
    branch: 'search',
    task: 'Keyboard search',
    side: 'right',
    log: ['reading src/search', 'adding useKeyboardSearch', 'writing 6 tests', 'running checks'],
    diff: [
      '+ export function useKeyboardSearch(results) {',
      '+   const [index, setIndex] = useState(0)',
      '+   onKey("ArrowDown", () => setIndex(index + 1))',
      '- <SearchResults results={results} />',
      '+ <SearchResults results={results} active={index} />',
    ],
    stat: ['+128', '−12'],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    branch: 'drafts',
    task: 'Lost drafts',
    side: 'bottom',
    log: [
      'reproducing the bug',
      'draft resets on route change',
      'saving per document',
      'running checks',
    ],
    diff: [
      '- const draft = null',
      '+ const draft = useSavedDraft(doc.id)',
      '+ restoreOnOpen(draft)',
      '+ test("keeps drafts across routes")',
    ],
    stat: ['+46', '−9'],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    branch: 'navigation',
    task: 'Simpler nav',
    side: 'left',
    log: [
      'mapping 11 routes',
      'trying a three item nav',
      'capturing before and after',
      'running checks',
    ],
    diff: [
      '- <Nav items={allRoutes} />',
      '+ <Nav items={primary} />',
      '+ <Menu items={secondary} />',
      '+ settings: menu("Settings")',
    ],
    stat: ['+212', '−87'],
  },
] as const;

const beats = [
  {
    title: 'One brief.',
    detail: 'Say what you want in plain language. That is the whole setup.',
  },
  {
    title: 'Three agents, at once.',
    detail: 'Each takes a task in its own worktree, so none of them can step on another.',
  },
  {
    title: 'One needs you.',
    detail: 'Questions come to you. Everything else keeps moving while you answer.',
  },
  {
    title: 'Ready for review.',
    detail: 'Three diffs, each with its checks. Nothing merges until you approve.',
  },
];

const BEATS = [0.18, 0.46, 0.76];
const beatOf = (progress: number) => BEATS.filter((at) => progress >= at).length;
const entry = {
  right: { x: 64, y: 0 },
  bottom: { x: 0, y: 64 },
  left: { x: -64, y: 0 },
};

function Tile({
  id,
  state,
  side,
  order = 0,
  children,
}: {
  id: string;
  state?: 'focused' | 'asking';
  side?: keyof typeof entry;
  order?: number;
  children: ReactNode;
}) {
  const from = side ? entry[side] : { x: 0, y: 0 };
  return (
    <motion.div
      layout
      className="lp-tile"
      data-state={state}
      style={{ gridArea: id }}
      initial={{ opacity: 0, ...from }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7, ease: EASE, delay: order * 0.12 }}
    >
      <motion.div layout="position" className="lp-tile-inner">
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * Pinned on wide screens: the work in four beats. The workspace rises into
 * view, splits for three agents at once, pauses one on a question and ends on the review.
 * Other layouts, reduced motion and server output show the finished work.
 */
function Workspace() {
  const section = useRef<HTMLElement>(null);
  const progress = usePinnedProgress(section);
  const beat = beatOf(progress);
  const typed = brief.slice(0, Math.round(clamp(progress / 0.14) * brief.length));
  const replied = answer.slice(0, Math.round(clamp((progress - 0.56) / 0.08) * answer.length));
  const answered = beat >= 3 || replied === answer;
  const rise = clamp(progress / 0.1);
  const run = clamp((progress - BEATS[0]) / (BEATS[2] - BEATS[0]));
  return (
    <section className="lp-workspace" id="how-it-works" aria-labelledby="how-title" ref={section}>
      <div className="lp-workspace-sticky">
        <div className="lp-width lp-workspace-grid">
          <h2 id="how-title" className="lp-sr">
            How Jackalope works
          </h2>
          <div className="lp-chapters-wrap">
            <div className="lp-chapter-rail" aria-hidden="true">
              {beats.map((item, index) => (
                <span key={item.title} data-done={index <= beat ? '' : undefined} />
              ))}
            </div>
            <ol className="lp-chapters">
              {beats.map((item, index) => (
                <li key={item.title} data-active={index === beat ? '' : undefined}>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="lp-screen-stage">
            <div
              className="lp-screen"
              data-stage={beat}
              style={
                {
                  '--areas': beat === 0 ? '"you you" "you you"' : '"you codex" "gemini claude"',
                  '--rise': rise,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <AnimatePresence initial={false}>
                <Tile key="you" id="you" state={beat === 0 || beat === 2 ? 'focused' : undefined}>
                  <div className="lp-tile-head">
                    <span className="lp-tile-title">you</span>
                    <span className="lp-tile-meta">storefront · main</span>
                  </div>
                  <p className="lp-brief">
                    <span className="lp-brief-sign">›</span> {typed}
                    {beat === 0 && <span className="lp-caret" />}
                  </p>
                  {beat >= 1 && (
                    <ul className="lp-dispatch">
                      {agents.map((agent) => (
                        <li key={agent.id}>
                          <span>
                            {beat === 3 ? '✓' : '→'} {agent.name}
                          </span>
                          <span>worktree/{agent.branch}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {beat >= 2 && (
                    <div className="lp-ask">
                      <p>
                        <span className="lp-ask-mark">◆</span> Claude Code asks: {question}
                      </p>
                      <p className="lp-brief">
                        <span className="lp-brief-sign">›</span> {beat >= 3 ? answer : replied}
                        {beat === 2 && !answered && <span className="lp-caret" />}
                      </p>
                    </div>
                  )}
                </Tile>
                {beat >= 1 &&
                  agents.map((agent, index) => {
                    const done = beat === 3;
                    const waiting = agent.id === 'claude' && beat === 2 && !answered;
                    const pace = agent.id === 'claude' && beat >= 2 ? Math.max(0.5, run) : run;
                    const steps = done ? 1 : waiting ? 0.5 : clamp(pace * (1.1 + index * 0.1));
                    const lines = Math.max(1, Math.ceil(steps * agent.diff.length));
                    const status = done
                      ? '✓ checks passed'
                      : waiting
                        ? '◆ needs you'
                        : `› ${agent.log[Math.min(agent.log.length - 1, Math.floor(steps * agent.log.length))]}`;
                    return (
                      <Tile
                        key={agent.id}
                        id={agent.id}
                        side={agent.side}
                        order={index}
                        state={waiting ? 'asking' : beat === 1 ? 'focused' : undefined}
                      >
                        <div className="lp-tile-head">
                          <span
                            className="lp-tile-face"
                            style={
                              { '--agent-color': PROVIDER_MARKS[agent.id]?.color } as CSSProperties
                            }
                          >
                            <AgentCharacter
                              provider={agent.id}
                              state={done ? 'idle' : waiting ? 'waiting' : 'working'}
                            />
                          </span>
                          <span className="lp-tile-name">
                            <span className="lp-tile-title">{agent.name}</span>
                            <span className="lp-tile-meta">worktree/{agent.branch}</span>
                          </span>
                          <span className="lp-tile-stat">
                            <span className="lp-add">{agent.stat[0]}</span>
                            <span className="lp-del">{agent.stat[1]}</span>
                          </span>
                        </div>
                        <span className="lp-tile-progress">
                          <span
                            className="lp-tile-fill"
                            style={{ transform: `scaleX(${steps})` }}
                          />
                        </span>
                        <ol className="lp-diff">
                          {agent.diff.slice(0, lines).map((line) => (
                            <li key={line} data-sign={line[0] === '+' ? 'add' : 'del'}>
                              {line}
                            </li>
                          ))}
                        </ol>
                        <p
                          className="lp-tile-status"
                          data-state={done ? 'done' : waiting ? 'asking' : undefined}
                        >
                          {status}
                        </p>
                      </Tile>
                    );
                  })}
              </AnimatePresence>
              <AnimatePresence>
                {beat === 3 && (
                  <motion.div
                    className="lp-finale"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                  >
                    <motion.div
                      className="lp-finale-card"
                      initial={{ opacity: 0, scale: 0.9, y: 24 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.6, ease: EASE }}
                    >
                      <p className="lp-finale-title">3 changes ready for review</p>
                      <ul>
                        {agents.map((agent) => (
                          <li key={agent.id}>
                            <span className="lp-ready-check">✓</span>
                            <span className="lp-finale-task">{agent.task}</span>
                            <span className="lp-tile-meta">{agent.name}</span>
                            <span className="lp-add">{agent.stat[0]}</span>
                            <span className="lp-del">{agent.stat[1]}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="lp-finale-foot">
                        <span>Nothing merged yet</span>
                        <span className="lp-key">Review</span>
                      </p>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Chapter: memory */

const notes = [
  { file: 'AGENTS.md', lines: ['## Checks', 'Run pnpm verify before', 'handing work back.'] },
  { file: 'lesson · drafts', lines: ['Drafts are saved per', 'document, not per route.'] },
  { file: 'workflow · release', lines: ['1. bump version', '2. write notes', '3. cut beta'] },
];

/* Chapter: agents */

const roster = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'grok', name: 'Grok' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'kimi', name: 'Kimi Code' },
  { id: 'antigravity', name: 'Antigravity' },
];

const providers = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'ollama', name: 'Ollama' },
];

function ProviderMark({ id }: { id: string }) {
  const mark = PROVIDER_MARKS[id];
  if (!mark) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill={mark.color ?? 'currentColor'}
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} clipRule="evenodd" />
      ))}
    </svg>
  );
}

/** Every agent turns to follow the pointer while the roster is on screen. */
function AgentRoster() {
  const list = useRef<HTMLUListElement>(null);
  const [gaze, setGaze] = useState<AgentGaze[]>([]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    if (window.matchMedia(REDUCED).matches || !window.matchMedia('(hover: hover)').matches) return;
    let frame = 0;
    let visible = false;
    let pointer = { x: 0, y: 0 };
    const update = () => {
      frame = 0;
      const faces = element.querySelectorAll<HTMLElement>('[data-face]');
      setGaze(
        Array.from(faces, (face) => {
          const box = face.getBoundingClientRect();
          const dx = pointer.x - (box.left + box.width / 2);
          const dy = pointer.y - (box.top + box.height / 2);
          const distance = Math.hypot(dx, dy) || 1;
          const reach = Math.min(1, distance / 220);
          return { x: (dx / distance) * reach, y: (dy / distance) * reach };
        }),
      );
    };
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (visible && !frame) frame = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(element);
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <ul className="lp-roster" ref={list}>
      {roster.map((agent, index) => (
        <li key={agent.id}>
          <span
            className="lp-roster-face"
            data-face=""
            style={{ '--agent-color': PROVIDER_MARKS[agent.id]?.color } as CSSProperties}
          >
            <AgentCharacter provider={agent.id} gaze={gaze[index]} />
          </span>
          {agent.name}
        </li>
      ))}
    </ul>
  );
}

/* Chapter: specifications, as keynote tiles */

/** Counts up to `value` the first time it scrolls into view; server output shows the value. */
function Count({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const element = ref.current;
    if (!element || value === 0 || window.matchMedia(REDUCED).matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight) return;
    setShown(0);
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / 1200);
          setShown(Math.round(value * (1 - (1 - t) ** 3)));
          if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return <span ref={ref}>{shown}</span>;
}

const features = [
  {
    kind: 'context',
    title: 'Project context',
    detail: 'Guidance in AGENTS.md reaches every task, and you can edit it any time.',
    href: '/features/project-context-for-coding-agents/',
  },
  {
    kind: 'lessons',
    title: 'Saved lessons',
    detail: '/learn turns what an agent figured out into context for the next task.',
    href: '/features/project-context-for-coding-agents/',
  },
  {
    kind: 'accounts',
    title: 'Work and personal accounts',
    detail: 'Named profiles per agent, with project defaults and usage tracked by account.',
    href: '/blog/work-and-personal-accounts/',
  },
  {
    kind: 'browser',
    title: 'Browser automation',
    detail: 'Agents open pages, click through flows, take screenshots and audit what they built.',
    href: '/knowledge/mcp-and-browser-automation/',
  },
  {
    kind: 'desktop',
    title: 'Desktop control',
    detail: 'On Windows, agents can use an app you select, the way you would.',
    href: '/knowledge/mcp-and-browser-automation/',
  },
  {
    kind: 'schedule',
    title: 'Scheduled tasks',
    detail: 'Run chores on a schedule with a history for every run, while the app is open.',
    href: '/features/recurring-coding-agent-tasks/',
  },
  {
    kind: 'watch',
    title: 'Branch watchers',
    detail: 'Run a check whenever a branch changes. Watching makes no model calls.',
    href: '/features/recurring-coding-agent-tasks/',
  },
  {
    kind: 'bots',
    title: 'Bots',
    detail: 'Give a helper a role, an agent and the tools it may use, then ask it anything.',
    href: '/knowledge/bots/',
  },
  {
    kind: 'terminal',
    title: 'Terminal command',
    detail: 'Type jackalope in any repository to work with agents without leaving the shell.',
    href: '/knowledge/terminal-command/',
  },
] as const;

const bots = [
  { name: 'Reviewer', shape: 'shield', color: '#4c86f0' },
  { name: 'Fixer', shape: 'cat', color: '#f2665c' },
  { name: 'Tester', shape: 'gem', color: '#1fa7bd' },
  { name: 'Polisher', shape: 'heart', color: '#e05297' },
];

const lessons = [
  'Drafts save per document',
  'Run pnpm test before handing back',
  'Theme state lives in useTheme',
];

/** A looping 3D sketch of each capability. Reduced motion holds a still frame. */
function FeatureVisual({ kind }: { kind: (typeof features)[number]['kind'] }) {
  switch (kind) {
    case 'context':
      return (
        <div className="lp-fv lp-fv-iso">
          <div className="lp-fv-pages">
            {[2, 1, 0].map((depth) => (
              <div className="lp-fv-page" key={depth} style={{ '--d': depth } as CSSProperties}>
                {depth === 0 && (
                  <>
                    <span className="lp-fv-file">AGENTS.md</span>
                    <i />
                    <i />
                    <i />
                    <i />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    case 'lessons':
      return (
        <div className="lp-fv lp-fv-deck">
          <kbd>/learn</kbd>
          <div className="lp-fv-deck-stack">
            {lessons.map((lesson, index) => (
              <span className="lp-fv-lesson" key={lesson} style={{ '--i': index } as CSSProperties}>
                ✓ {lesson}
              </span>
            ))}
          </div>
        </div>
      );
    case 'accounts':
      return (
        <div className="lp-fv lp-fv-flip">
          <div className="lp-fv-flip-card">
            <span className="lp-fv-face">
              <b>Work</b>
              <small>Claude Code · acme team</small>
            </span>
            <span className="lp-fv-face lp-fv-face-back">
              <b>Personal</b>
              <small>Claude Code · own plan</small>
            </span>
          </div>
        </div>
      );
    case 'browser':
      return (
        <div className="lp-fv lp-fv-stage">
          <div className="lp-fv-window lp-fv-browser">
            <span className="lp-fv-bar">
              <i />
              <i />
              <i />
              <span>localhost:5173/checkout</span>
            </span>
            <span className="lp-fv-button">Place order</span>
            <span className="lp-fv-ripple" />
            <MousePointer2 className="lp-fv-cursor" size={18} />
          </div>
          {[0, 1, 2].map((index) => (
            <span className="lp-fv-shot" key={index} style={{ '--i': index } as CSSProperties} />
          ))}
        </div>
      );
    case 'desktop':
      return (
        <div className="lp-fv lp-fv-iso">
          <div className="lp-fv-app">
            <span className="lp-fv-app-bar">Inventory</span>
            {[0, 1, 2, 3].map((index) => (
              <i key={index} style={{ '--i': index } as CSSProperties} />
            ))}
          </div>
        </div>
      );
    case 'schedule':
      return (
        <div className="lp-fv lp-fv-iso">
          <div className="lp-fv-calendar">
            {Array.from({ length: 28 }, (_, day) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: calendar cells are positions.
                key={day}
                data-off={day % 7 > 4 ? '' : undefined}
                style={{ '--i': (day % 7) + Math.floor(day / 7) } as CSSProperties}
              />
            ))}
          </div>
          <small className="lp-fv-caption">weekdays · 09:00</small>
        </div>
      );
    case 'watch':
      return (
        <div className="lp-fv lp-fv-track-stage">
          <div className="lp-fv-track">
            <span className="lp-fv-rail" />
            {[0, 1, 2].map((index) => (
              <span
                className="lp-fv-commit"
                key={index}
                style={{ '--i': index } as CSSProperties}
              />
            ))}
          </div>
          <span className="lp-fv-sign">✓ checks ran</span>
          <small className="lp-fv-caption">watching main</small>
        </div>
      );
    case 'bots':
      return (
        <div className="lp-fv lp-fv-turn" aria-hidden="true">
          <div className="lp-fv-turntable">
            {bots.map((bot, index) => (
              <div
                className="lp-fv-turn-slot"
                key={bot.shape}
                style={{ '--a': `${index * 90}deg`, '--agent-color': bot.color } as CSSProperties}
              >
                <span className="lp-fv-turn-face">
                  <span className="lp-fv-bot-face">
                    <AgentCharacter provider={bot.shape} />
                  </span>
                  {bot.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    default:
      return (
        <div className="lp-fv lp-fv-stage">
          <div className="lp-fv-window lp-fv-term">
            <span className="lp-fv-line-1">
              <span className="lp-fv-prompt">~/storefront $ </span>
              <span className="lp-fv-typed">jackalope</span>
            </span>
            <span className="lp-fv-line-2">› fix the flaky cart test</span>
            <span className="lp-fv-line-3">✓ 2 files changed · checks passed</span>
          </div>
        </div>
      );
  }
}

function Features() {
  return (
    <div className="lp-feature-grid" data-reveal="">
      {features.map((feature) => (
        <a className="lp-feature" data-kind={feature.kind} href={feature.href} key={feature.kind}>
          <FeatureVisual kind={feature.kind} />
          <h3>
            {feature.title} <ArrowRight size={16} aria-hidden="true" />
          </h3>
          <p className="lp-feature-detail">{feature.detail}</p>
        </a>
      ))}
    </div>
  );
}

/** The agent logos orbit the figure on a tilted ring; the figure sits inside the ring's depth. */
function Orbit({ children }: { children: ReactNode }) {
  return (
    <div className="lp-orbit" aria-hidden="true">
      <div className="lp-orbit-ring">
        <div className="lp-orbit-center">{children}</div>
        {roster.map((agent, index) => (
          <div
            className="lp-orbit-slot"
            key={agent.id}
            style={{ '--a': `${(index * 360) / roster.length}deg` } as CSSProperties}
          >
            <span className="lp-orbit-face">
              <ProviderMark id={agent.id} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const branches = [
  'M24 92 C44 92 44 28 64 28 H176 C196 28 196 92 216 92',
  'M40 92 C58 92 58 50 76 50 H164 C182 50 182 92 200 92',
  'M56 92 C72 92 72 72 88 72 H152 C168 72 168 92 184 92',
];

/** Three branches leave main and merge back, with work travelling along each. */
function BranchGraph() {
  const [moving, setMoving] = useState(false);
  useEffect(() => setMoving(!window.matchMedia(REDUCED).matches), []);
  return (
    <svg className="lp-branches" viewBox="0 0 240 112" aria-hidden="true">
      <path className="lp-branch-main" d="M8 92 H232" />
      {branches.map((d, index) => (
        <g key={d} style={{ '--i': index } as CSSProperties}>
          <path className="lp-branch" d={d} pathLength={1} />
          <circle r="3" className="lp-branch-dot">
            {moving && (
              <animateMotion
                dur={`${3.2 + index * 0.6}s`}
                begin={`${index * 0.5}s`}
                repeatCount="indefinite"
                path={d}
              />
            )}
          </circle>
        </g>
      ))}
      <circle cx="8" cy="92" r="4" className="lp-branch-node" />
      <circle cx="232" cy="92" r="4" className="lp-branch-node" />
    </svg>
  );
}

/** A keycap that presses itself, then shows the approval it stands for. */
function ApproveKey() {
  return (
    <div className="lp-approve" aria-hidden="true">
      <span className="lp-approve-key">
        <span className="lp-approve-face">Approve</span>
      </span>
      <span className="lp-approve-check">
        <Check size={16} strokeWidth={3} />
      </span>
    </div>
  );
}

/** Work circles inside a boundary around the computer and never leaves it. */
function LocalRadar() {
  return (
    <div className="lp-radar" aria-hidden="true">
      <span className="lp-radar-pulse" />
      <span className="lp-radar-pulse" />
      <span className="lp-radar-orbit">
        <i />
        <i />
        <i />
      </span>
      <span className="lp-radar-core">
        <Laptop size={22} />
      </span>
    </div>
  );
}

/** The provider logos as an exploded stack of layers, floating apart. */
function ProviderStack() {
  return (
    <div className="lp-stack" aria-hidden="true">
      <div className="lp-stack-plane">
        {providers.map((provider, index) => (
          <span
            className="lp-stack-layer"
            key={provider.id}
            style={{ '--i': index } as CSSProperties}
          >
            <ProviderMark id={provider.id} />
          </span>
        ))}
      </div>
    </div>
  );
}

function Specs({ platforms }: { platforms: string }) {
  return (
    <div className="lp-keynote" data-reveal="">
      <article className="lp-spec lp-spec-hero">
        <Orbit>
          <p className="lp-spec-figure">
            <Count value={roster.length} />
          </p>
        </Orbit>
        <h3>coding agents, one workspace</h3>
        <p>{roster.map((agent) => agent.name).join(' · ')}</p>
      </article>
      <article className="lp-spec">
        <p className="lp-spec-figure">
          <Count value={1} />
        </p>
        <h3>Git worktree per task</h3>
        <p>Its own branch and folder, so parallel work never collides.</p>
        <BranchGraph />
      </article>
      <article className="lp-spec">
        <p className="lp-spec-figure">0</p>
        <h3>merges without you</h3>
        <p>Diff, checks and merge wait in one view until you approve.</p>
        <ApproveKey />
      </article>
      <article className="lp-spec">
        <p className="lp-spec-figure lp-spec-word">Local</p>
        <h3>on your computer</h3>
        <p>
          Desktop app for {platforms}. Repositories and credentials stay with you; agents reach
          their providers under your settings.
        </p>
        <LocalRadar />
      </article>
      <article className="lp-spec">
        <p className="lp-spec-figure">
          <Count value={providers.length} />
        </p>
        <h3>model providers, direct</h3>
        <p>{providers.map((provider) => provider.name).join(' · ')}</p>
        <ProviderStack />
      </article>
      <article className="lp-spec lp-spec-wide">
        <p className="lp-spec-figure">$0</p>
        <h3>for your account</h3>
        <p>Bring the agent subscriptions you already pay for.</p>
      </article>
      <article className="lp-spec lp-spec-wide">
        <p className="lp-spec-figure lp-spec-word">Apache 2.0</p>
        <h3>open source</h3>
        <p>
          <a href={GITHUB_URL}>Read the code on GitHub</a>
        </p>
      </article>
    </div>
  );
}

export function LandingPage({
  signup,
  faqs,
  platforms,
}: {
  signup: ReactNode;
  faqs: string[][];
  platforms: string;
}) {
  const landing = useRef<HTMLElement>(null);
  useEffect(() => {
    // Sections start hidden only once this runs, so prerendered pages stay readable without it.
    const root = landing.current;
    root?.classList.add('lp-js');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.entered = 'true';
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );
    for (const section of root?.querySelectorAll('[data-reveal]') ?? []) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <main id="main" className="lp" ref={landing}>
      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="lp-hero-mark">
          <AsciiMark />
        </div>
        <div className="lp-width lp-hero-copy">
          <h1 id="hero-title">
            <span className="lp-line">
              <span className="lp-line-text">Run your agents</span>
            </span>{' '}
            <span className="lp-line">
              <span className="lp-line-text">side by side.</span>
            </span>
          </h1>
          <p className="lp-lede">
            Jackalope is a desktop workspace for Codex, Claude Code, Gemini CLI and more. Every task
            runs in its own Git worktree, and nothing lands until you approve it.
          </p>
          <div className="lp-actions">
            <a className="lp-download" href="/download/">
              <ArrowDownToLine size={20} aria-hidden="true" />
              Download Jackalope
            </a>
            <a className="lp-source" href={GITHUB_URL}>
              <GitHubIcon size={18} />
              View source
            </a>
          </div>
          <div className="lp-logos">
            <p className="lp-strip-label">Works with the agents you already use</p>
            <ul>
              {roster.map((agent) => (
                <li key={agent.id}>
                  <ProviderMark id={agent.id} />
                  {agent.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <Workspace />

      <section className="lp-memory" aria-labelledby="memory-title">
        <div className="lp-width lp-split">
          <div className="lp-split-copy">
            <h2 id="memory-title">It remembers how your project works.</h2>
            <p>
              Run <code>/init</code> once to write your project guidance. Save what an agent learns
              with <code>/learn</code>. The next task starts with all of it, and you can edit any of
              it.
            </p>
          </div>
          <div className="lp-notes" data-reveal="" aria-hidden="true">
            {notes.map((note, index) => (
              <div className="lp-note" key={note.file} style={{ '--i': index } as CSSProperties}>
                <span className="lp-note-file">{note.file}</span>
                {note.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cli" id="inside" aria-labelledby="cli-title">
        <div className="lp-width">
          <h2 id="cli-title" className="lp-center">
            Or never leave the terminal.
          </h2>
          <p className="lp-center lp-cli-detail">
            Type <code>jackalope</code> in any repository. It picks an agent, shows what it is doing
            and asks when it needs you.
          </p>
          <TerminalDemo />
        </div>
      </section>

      <section className="lp-agents" aria-labelledby="agents-title">
        <div className="lp-width">
          <h2 id="agents-title" className="lp-center">
            Bring the agents you already pay for.
          </h2>
          <AgentRoster />
          <div className="lp-providers">
            <p className="lp-strip-label">Or connect models directly, including local ones</p>
            <ul>
              {providers.map((provider) => (
                <li key={provider.id}>
                  <ProviderMark id={provider.id} />
                  {provider.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-specs" id="features" aria-labelledby="specs-title">
        <div className="lp-width">
          <h2 id="specs-title" className="lp-center">
            What's inside.
          </h2>
          <Specs platforms={platforms} />
          <h2 id="features-title" className="lp-center lp-features-title">
            And everything around them.
          </h2>
          <Features />
        </div>
      </section>

      <section className="lp-faq" id="questions" aria-labelledby="questions-title">
        <div className="lp-width lp-faq-grid">
          <div>
            <h2 id="questions-title">Questions</h2>
            <p>
              More in the <a href="/knowledge/">knowledgebase</a>, or{' '}
              <a href="/compare/">compare workflows</a>.
            </p>
          </div>
          <div className="lp-faq-list">
            {faqs.map(([question, answer, id]) => (
              <Disclosure key={question} id={id}>
                <DisclosureSummary>{question}</DisclosureSummary>
                <p>{answer}</p>
              </Disclosure>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final" id="download" aria-labelledby="final-title">
        <div className="lp-final-mark">
          <AsciiMark echoes={4} />
        </div>
        <div className="lp-width lp-final-body">
          <h2 id="final-title" className="lp-center">
            Start your first parallel task.
          </h2>
          <p className="lp-center lp-final-lede">
            Free account, ready as soon as you confirm your email. Bring your own agents.
          </p>
          <div className="lp-final-form" id="newsletter">
            {signup}
            <a className="lp-final-download" href="/download/">
              <ArrowDownToLine size={16} aria-hidden="true" />
              <span className="lp-final-download-label">
                Already have an account? <strong>Download for {platforms}</strong>
              </span>
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
