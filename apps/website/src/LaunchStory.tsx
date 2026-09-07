import { PRESET_THEMES } from '@jackalope/brand/theme';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowDown, ArrowRight, Check, Moon, Play, Plus, Sun } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { AgentSupport } from './AgentSupport';
import { BrandEmblem } from './BrandEmblem';
import { BrandMark } from './BrandMark';

const useCases = [
  {
    id: 'feature',
    label: 'Ship a feature',
    idea: 'Make this project feel like a product.',
    brief: 'Build keyboard search and polish the settings experience.',
    tasks: ['Build keyboard search', 'Polish the settings'],
    agents: ['Codex', 'Claude Code'],
    file: 'Search.tsx',
    code: ['+ onKeyDown={navigate}', '+ activeIndex={selected}', '+ onClose={returnFocus}'],
    result: 'Keyboard search, ready for your review.',
  },
  {
    id: 'fix',
    label: 'Untangle a bug',
    idea: 'Find the bug. Keep the good parts.',
    brief: 'Fix lost task drafts and investigate the slow history view.',
    tasks: ['Keep unfinished drafts', 'Investigate slow history'],
    agents: ['Claude Code', 'Grok'],
    file: 'TaskComposer.tsx',
    code: ['+ const draft = useSavedDraft()', '+ restoreOnOpen(draft)', '+ clearAfterCreate()'],
    result: 'Drafts survive a refresh. You inspect the fix.',
  },
  {
    id: 'explore',
    label: 'Try a bigger idea',
    idea: 'What if the next version worked like this?',
    brief: 'Explore a new navigation flow and a different settings layout.',
    tasks: ['Explore navigation', 'Rethink settings'],
    agents: ['OpenCode', 'Codex'],
    file: 'Navigation.tsx',
    code: ['+ <ProjectNavigation />', '+ <QuickActions />', '+ <RecentWork />'],
    result: 'An experiment you can keep, refine, or leave.',
  },
];
const chapters = [
  {
    id: 'idea',
    word: 'Start anywhere.',
    title: 'A rough idea is enough.',
    text: 'Capture the thought before it disappears. Keep it as a draft, or pick a local project and give an agent an outcome to work toward.',
    feature: 'Ideas, drafts & agent tasks',
  },
  {
    id: 'context',
    word: 'Bring your world.',
    title: 'The next task gets a head start.',
    text: 'Bring the project’s instructions, selected tools, lessons, and reusable workflows. Inspect what the agent receives. Keep that context when you continue.',
    feature: 'Project knowledge & connections',
  },
  {
    id: 'parallel',
    word: 'Let it branch.',
    title: 'More than one thing can move forward.',
    text: 'Give independent tasks to different agents in separate Git worktrees. Follow their progress and questions together. Scopes and dependencies help coordinate the work.',
    feature: 'Parallel tasks & isolated worktrees',
  },
  {
    id: 'review',
    word: 'Keep the last word.',
    title: 'It comes back to your judgment.',
    text: 'Read the result, inspect the patch, and check the evidence. Ask for another iteration or explicitly integrate the work. Finishing a task does not automatically merge it.',
    feature: 'Changes, checks & guarded integration',
  },
];

function StoryVisual({ phase, example }: { phase: number; example: (typeof useCases)[number] }) {
  const reduced = useReducedMotion();
  return (
    <div className="thread-visual" data-phase={phase}>
      <div className="thread-caption">
        <span>JACKALOPE / AN ILLUSTRATED WORKFLOW</span>
        <span>{chapters[phase].feature}</span>
      </div>
      <svg viewBox="0 0 640 580" className="thread-drawing" fill="none" aria-hidden="true">
        <path
          className="thread-ghost"
          d="M80 95 C390 -10 590 110 410 190 C250 260 65 235 140 340 C205 420 395 260 490 340 C610 440 365 580 235 460"
        />
        <motion.path
          className="thread-ink"
          d="M80 95 C390 -10 590 110 410 190 C250 260 65 235 140 340 C205 420 395 260 490 340 C610 440 365 580 235 460"
          initial={false}
          animate={{ pathLength: [0.17, 0.47, 0.76, 1][phase] }}
          transition={{ duration: reduced ? 0 : 1.1 }}
        />
        {phase === 2 && (
          <g className="thread-forks">
            <path d="M315 240 C315 290 150 255 150 350 L150 420 M315 240 C315 290 500 255 500 350 L500 420" />
            <circle cx="150" cy="420" r="5" />
            <circle cx="500" cy="420" r="5" />
          </g>
        )}
        {phase === 1 && (
          <g className="context-orbit">
            <circle cx="320" cy="285" r="137" />
            <circle cx="320" cy="285" r="187" />
          </g>
        )}
      </svg>
      <div className="thread-scene" key={`${phase}-${example.id}`}>
        {phase === 0 && (
          <div className="thought-art">
            <span>A THOUGHT, STILL TAKING SHAPE</span>
            <p>“{example.idea}”</p>
            <small>{example.brief}</small>
            <span className="pencil-arrow" aria-hidden="true">
              ↙
            </span>
          </div>
        )}
        {phase === 1 && (
          <div className="context-art">
            <span className="context-center">
              <BrandMark />
              Your project
            </span>
            <span className="context-note note-north">
              The way you build<small>Project instructions</small>
            </span>
            <span className="context-note note-west">
              What you’ve learned<small>Lessons & workflows</small>
            </span>
            <span className="context-note note-east">
              What you need<small>Selected tools</small>
            </span>
          </div>
        )}
        {phase === 2 && (
          <div className="parallel-art">
            <p>
              One project.
              <br />
              Room for both.
            </p>
            {example.tasks.map((task, index) => (
              <div className={`agent-track track-${index}`} key={task}>
                <span>{example.agents[index]}</span>
                <h3>{task}</h3>
                <small>Separate worktree / {index + 1}</small>
              </div>
            ))}
          </div>
        )}
        {phase === 3 && (
          <div className="review-art">
            <span className="review-art-file">
              {example.file} <span>ILLUSTRATIVE PATCH</span>
            </span>
            <pre>{example.code.join('\n')}</pre>
            <div className="review-art-check">
              <Check size={16} /> Example project checks passed
            </div>
            <p>{example.result}</p>
            <span className="review-decision">
              Your call.
              <ArrowRight size={32} />
            </span>
          </div>
        )}
      </div>
      <motion.div
        className="thread-traveler"
        initial={false}
        animate={
          reduced
            ? { x: 0, y: 0 }
            : {
                x: [0, 50, 190, 20][phase],
                y: [0, -35, 5, 25][phase],
                rotate: [-8, 5, -5, 0][phase],
              }
        }
        transition={{ duration: 0.9, type: 'spring', bounce: 0.15 }}
      >
        <BrandEmblem />
      </motion.div>
      <div className="thread-scene-footer">
        <span>Sample project. No agents are running here.</span>
        <span aria-hidden="true">0{phase + 1} / 04</span>
      </div>
    </div>
  );
}

function ScrollStory() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [phase, setPhase] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: root, offset: ['start center', 'end end'] });
  useEffect(() => {
    const rootNode = root.current;
    if (!rootNode) return;
    const nodes = [...rootNode.querySelectorAll<HTMLElement>('[data-story-chapter]')];
    let frame = 0;
    const update = () => {
      frame = 0;
      const stageBottom =
        rootNode.querySelector('.story-stage')?.getBoundingClientRect().bottom ?? 0;
      const readingLine =
        window.innerWidth <= 760
          ? Math.min(innerHeight - 30, stageBottom + (innerHeight - stageBottom) * 0.45)
          : innerHeight * 0.55;
      let next = 0;
      for (const [index, node] of nodes.entries()) {
        if (node.getBoundingClientRect().top <= readingLine) next = index;
      }
      setPhase(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return (
    <section className="wild-story" id="workflow" aria-labelledby="story-title">
      <div className="wild-story-intro wild-width">
        <span className="wild-label">FOLLOW ONE IDEA</span>
        <h2 id="story-title">See where it goes.</h2>
        <div className="story-choice-row">
          <fieldset className="use-case-picker">
            <legend>What do you want to do?</legend>
            {useCases.map((item, index) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={exampleIndex === index}
                onClick={() => setExampleIndex(index)}
              >
                {item.label}
                <ArrowRight size={15} />
              </button>
            ))}
          </fieldset>
          <a className="wild-underlink" href="#inside">
            Skip to the actual app <ArrowDown size={15} />
          </a>
        </div>
      </div>
      <div className="scroll-story-body wild-width" ref={root}>
        <div className="story-stage">
          <StoryVisual phase={phase} example={useCases[exampleIndex]} />
          <nav aria-label="Story chapters" className="story-chapter-nav">
            {chapters.map((chapter, index) => (
              <a
                key={chapter.id}
                href={`#chapter-${chapter.id}`}
                aria-current={phase === index ? 'step' : undefined}
              >
                {chapter.id}
                <span className="sr-only">: {chapter.title}</span>
              </a>
            ))}
          </nav>
          <motion.div
            className="story-progress"
            style={{ scaleX: reduced ? 1 : scrollYProgress }}
          />
        </div>
        <div className="story-prose">
          {chapters.map((chapter, index) => (
            <article
              key={chapter.id}
              id={`chapter-${chapter.id}`}
              data-story-chapter
              data-phase={index}
              className="story-chapter"
            >
              <span className="chapter-word">{chapter.word}</span>
              <h3>{chapter.title}</h3>
              <p>{chapter.text}</p>
              <span className="chapter-feature">{chapter.feature}</span>
              {index < 3 ? (
                <a href={`#chapter-${chapters[index + 1].id}`} className="chapter-next">
                  {chapters[index + 1].word}
                  <ArrowDown size={18} />
                </a>
              ) : (
                <a href="#inside" className="chapter-next">
                  Now see the app <ArrowDown size={18} />
                </a>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const scenes = [
  {
    id: 'tasks',
    label: 'Tasks & ideas',
    title: 'The whole picture, without the window juggling.',
    image: 'tasks',
    description:
      'Save ideas, follow active tasks, and see what needs your attention across projects.',
  },
  {
    id: 'review',
    label: 'Review & checks',
    title: 'The result and the evidence, together.',
    image: 'review',
    description:
      'Inspect a task’s patch and project checks, then continue the work or decide what to integrate.',
  },
  {
    id: 'agents',
    label: 'Coding agents',
    title: 'Familiar agents. A shared place to work.',
    image: 'agents',
    description:
      'Choose a supported local agent and bring your existing account. Model access is supplied by your provider.',
  },
];

export function WildLanding({
  action,
  downloadAction,
  dark,
  setDark,
  palette,
  setPalette,
  onPlay,
  faqs,
  available,
  releaseVersion,
}: {
  action: ReactNode;
  downloadAction: ReactNode;
  dark: boolean;
  setDark: (value: boolean) => void;
  palette: number;
  setPalette: (value: number) => void;
  onPlay: () => void;
  faqs: string[][];
  available: boolean;
  releaseVersion?: string;
}) {
  const hero = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const heroDrift = useTransform(scrollYProgress, [0, 1], [0, 70]);
  return (
    <main id="main" className="wild-landing">
      <section className="wild-hero wild-width" aria-labelledby="hero-title" ref={hero}>
        <div className="wild-hero-copy">
          <p className="wild-label">A LOCAL WORKSPACE FOR CODING AGENTS</p>
          <h1 id="hero-title">
            Your ideas.
            <br />
            In good company.
          </h1>
          <div className="wild-hero-description">
            <p>One desktop workspace to put your coding agents to work.</p>
            <p>
              Keep the context. Run tasks in parallel. Review what comes back. You bring the
              ideas—and the final say.
            </p>
          </div>
          <div className="wild-hero-actions">
            <a href="#workflow" className="wild-follow">
              Follow an idea <ArrowDown size={19} />
            </a>
            {action}
          </div>
          <p className="wild-availability">
            {available
              ? `Windows x64 · ${releaseVersion ?? 'Available now'}`
              : 'Early access · Windows first · macOS & Linux planned'}
          </p>
        </div>
        <motion.div className="wild-hero-art" style={{ y: reduced ? 0 : heroDrift }}>
          <svg className="hero-orbit" viewBox="0 0 650 660" fill="none" aria-hidden="true">
            <circle cx="325" cy="330" r="235" />
            <circle cx="325" cy="330" r="270" strokeDasharray="2 8" />
            <path d="M325 30 V100 M325 560 V630 M20 330 H90 M560 330 H630 M70 75 H95 M82 62 V88 M555 75 H580 M568 62 V88 M70 585 H95 M82 572 V598 M555 585 H580 M568 572 V598" />
            <path d="M130 525 L515 140 M125 135 L520 530" opacity="0.2" />
          </svg>
          <span className="hero-handnote">
            J / JACKALOPE
            <br />
            LOCAL BY DESIGN
          </span>
          <BrandEmblem href="#workflow" className="hero-creature" />
          <span className="hero-art-bottom">CONTEXT → WORK → REVIEW</span>
        </motion.div>
        <div className="wild-hero-bottom">
          <span>Built for the way you actually make things.</span>
          <span>
            Codex <i>/</i> Claude Code <i>/</i> Grok <i>/</i> OpenCode
          </span>
        </div>
      </section>
      <ScrollStory />
      <section className="wild-inside wild-width" id="inside" aria-labelledby="inside-title">
        <div className="wild-section-heading">
          <span className="wild-label">INSIDE THE WORKSPACE</span>
          <h2 id="inside-title">
            A place for
            <br />
            all that possibility.
          </h2>
          <p>
            Local projects. Your agent accounts. A focused workspace that carries the work from the
            first thought to the next iteration.
          </p>
        </div>
        <Tabs.Root defaultValue="tasks" className="wild-product">
          <Tabs.List aria-label="Explore the workspace">
            {scenes.map((scene) => (
              <Tabs.Trigger value={scene.id} key={scene.id}>
                {scene.label}
                <ArrowRight size={16} />
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {scenes.map((scene) => (
            <Tabs.Content value={scene.id} key={scene.id}>
              <div className="wild-product-caption">
                <h3>{scene.title}</h3>
                <p>{scene.description}</p>
              </div>
              <button
                type="button"
                className="wild-capture"
                aria-label="Play the Jackalope product walkthrough"
                onClick={onPlay}
              >
                <img
                  src={`/media/${scene.image}${dark ? '' : '-light'}.png`}
                  width="1440"
                  height="840"
                  loading="lazy"
                  alt={`Actual Jackalope ${scene.label.toLowerCase()} interface with Atlas sample project data`}
                />
                <span>
                  <Play size={17} fill="currentColor" /> See it in motion
                </span>
              </button>
              <p className="wild-caption">
                Actual app · Atlas sample project · Recording uses illustrative data
              </p>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </section>
      <section
        className="wild-fieldguide wild-width"
        id="features"
        aria-labelledby="features-title"
      >
        <span className="wild-label">BUILT AROUND THE WORK</span>
        <h2 id="features-title">
          Less tending.
          <br />
          <em>More making.</em>
        </h2>
        <div className="fieldguide-row">
          <div className="fieldguide-art memory-art" aria-hidden="true">
            <span>instructions</span>
            <span>lessons</span>
            <span>workflows</span>
            <b>→ next idea</b>
          </div>
          <div>
            <h3>A project that remembers.</h3>
            <p>
              Save lessons and reusable workflows alongside project instructions. Choose the
              knowledge and connected tools a task needs, then inspect the context it received.
            </p>
            <small>
              Project knowledge & centrally managed connections. Tool support varies by agent.
            </small>
          </div>
        </div>
        <div className="fieldguide-row">
          <div className="fieldguide-art accounts-art" aria-hidden="true">
            <span>
              work<span>●</span>
            </span>
            <i>↔</i>
            <span>
              play<span>●</span>
            </span>
          </div>
          <div>
            <h3>Room for every side of you.</h3>
            <p>
              Set agent accounts and allowed runners per project. Keep client work and personal
              projects organized, while following tasks and reported usage in one place.
            </p>
            <a className="wild-underlink" href="/blog/work-and-personal-accounts/">
              How account profiles work <ArrowRight size={15} />
            </a>
          </div>
        </div>
        <div className="fieldguide-row">
          <div className="fieldguide-art rhythm-art" aria-hidden="true">
            <span>M</span>
            <span>T</span>
            <span>W</span>
            <span>T</span>
            <span>F</span>
            <svg viewBox="0 0 400 60" aria-hidden="true">
              <path
                d="M0 30 Q40 -15 80 30 T160 30 T240 30 T320 30 T400 30"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </div>
          <div>
            <h3>Put repeat work on a rhythm.</h3>
            <p>
              Schedule recurring tasks with their project context intact. Each run keeps its own
              result and history for you to inspect.
            </p>
            <small>Scheduled work runs while Jackalope and your computer are awake.</small>
          </div>
        </div>
      </section>
      <section className="wild-atmosphere" id="atmosphere" aria-labelledby="atmosphere-title">
        <div className="wild-width atmosphere-composition">
          <div>
            <span className="wild-label">YOUR WORKSPACE, YOUR ATMOSPHERE</span>
            <h2 id="atmosphere-title">
              Make yourself
              <br />
              <em>at home.</em>
            </h2>
            <p>A workspace can feel like you. Try a palette—the whole page comes along.</p>
            <fieldset className="palette-options" aria-label="Try a color palette">
              {PRESET_THEMES.slice(0, 4).map((theme, index) => (
                <button
                  key={theme.id}
                  type="button"
                  className="palette-button"
                  style={{ '--swatch': theme.accentHex } as CSSProperties}
                  aria-label={theme.name}
                  aria-pressed={palette === index}
                  onClick={() => setPalette(index)}
                >
                  {palette === index && <Check size={17} />}
                </button>
              ))}
              <span>{PRESET_THEMES[palette].name}</span>
            </fieldset>
            <fieldset className="appearance-options" aria-label="Try an appearance">
              <button type="button" aria-pressed={!dark} onClick={() => setDark(false)}>
                <Sun size={16} />
                Light
              </button>
              <button type="button" aria-pressed={dark} onClick={() => setDark(true)}>
                <Moon size={16} />
                Dark
              </button>
            </fieldset>
          </div>
          <div className="atmosphere-character">
            <BrandEmblem />
            <span>
              The same shared palette.
              <br />
              From the site to your workspace.
            </span>
          </div>
        </div>
      </section>
      <div className="wild-width wild-agent-details">
        <details>
          <summary>
            Meet your agents. Know what’s supported.
            <Plus size={20} />
          </summary>
          <AgentSupport />
        </details>
      </div>
      <section
        className="wild-questions wild-width"
        id="questions"
        aria-labelledby="questions-title"
      >
        <h2 id="questions-title">
          A few things
          <br />
          you might wonder.
        </h2>
        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <Plus size={18} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="wild-finale" id="download" aria-labelledby="download-title">
        <div className="wild-width">
          <span className="wild-label">MAKE ROOM FOR YOUR NEXT IDEA</span>
          <h2 id="download-title">
            Let’s see
            <br />
            where it <em>goes.</em>
          </h2>
          <div className="wild-finale-bottom">
            <p>
              {available
                ? 'Your Windows workspace is ready.'
                : 'Join the waitlist for early access.'}
              <br />
              Bring your own agents. Keep control of the work.
            </p>
            {downloadAction}
          </div>
          <p className="wild-availability">
            {available
              ? `Windows x64 · ${releaseVersion ?? 'Available now'} · macOS & Linux planned`
              : 'Windows first · macOS & Linux planned · No payment to join'}
          </p>
          <BrandMark className="finale-mark" />
        </div>
      </section>
    </main>
  );
}
