import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  Check,
  Code2,
  GitBranch,
  Layers3,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Play,
  Plus,
  Sun,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { characterPaths } from '../../desktop/src/components/mascot/character-paths';
import { applyThemeTokens, PRESET_THEMES } from '../../desktop/src/lib/theme-engine';
import { JournalPage, JournalTeaser } from './Journal';
import { Newsletter, WaitlistButton } from './Signup';

const downloadUrl = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL?.trim();
const version = import.meta.env.VITE_RELEASE_VERSION?.trim();
const asset = (name: string) => `/media/${name}`;

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="38 3 105 117" fill="currentColor" aria-hidden="true" className={className}>
      <path d={characterPaths.farEar} />
      <path d={characterPaths.nearEar} />
      <path d={characterPaths.antler} />
      <path d={characterPaths.head} />
    </svg>
  );
}

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 1, y: 0 }}
      whileInView={reduced ? {} : { y: [16, 0] }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function DownloadButton({ compact = false }: { compact?: boolean }) {
  if (!downloadUrl) return <WaitlistButton compact={compact} />;
  return (
    <a
      className={`button button-primary button-download ${compact ? 'button-compact' : ''}`}
      href="#download"
    >
      <span>{compact ? 'Get Jackalope' : 'Get Jackalope for Windows'}</span>
      <ArrowDownToLine size={16} />
    </a>
  );
}

function HeroSurface({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  return (
    <motion.div
      className="product-surround hero-surface"
      onPointerMove={(event) => {
        if (reduced || event.pointerType !== 'mouse') return;
        const bounds = event.currentTarget.getBoundingClientRect();
        setTilt({
          x: (event.clientX - bounds.left) / bounds.width - 0.5,
          y: (event.clientY - bounds.top) / bounds.height - 0.5,
        });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      animate={{
        rotateX: reduced ? 0 : -tilt.y * 2,
        rotateY: reduced ? 0 : tilt.x * 2,
        transformPerspective: 1400,
      }}
      transition={{ type: 'spring', stiffness: 130, damping: 25 }}
    >
      {children}
    </motion.div>
  );
}

const scenes = [
  {
    id: 'tasks',
    label: 'Tasks & ideas',
    image: 'tasks.png',
    title: 'Keep ideas and active work together.',
    description:
      'Save a thought for later or start an agent now. Switch between a list and a board as your project takes shape.',
    features: ['Save ideas for later', 'List and board views', 'Follow each attempt'],
    alt: 'Jackalope Tasks board with ideas, an agent at work, a task ready for review, and finished work in the Atlas sample project.',
  },
  {
    id: 'review',
    label: 'Review & checks',
    image: 'review.png',
    title: 'See the change before you accept it.',
    description:
      'Read the result, inspect the patch, and see the checks before deciding what comes next.',
    features: ['Inspect the code patch', 'Run your project checks', 'Ask for another iteration'],
    alt: 'Jackalope task review showing the search code patch, changed file, and passed project verification in the Atlas sample project.',
  },
  {
    id: 'agents',
    label: 'Coding agents',
    image: 'agents.png',
    title: 'Choose who takes the next task.',
    description:
      'Choose Codex or Claude Code, keep your existing accounts, and give each task the right context.',
    features: ['Use your existing sign-in', 'Choose an agent per task', 'See work in progress'],
    alt: 'The Jackalope Agents screen with locally configured Codex and Claude Code agents in the Atlas sample project.',
  },
];

const faqs = [
  [
    'What is Jackalope?',
    'Jackalope is a desktop workspace for agent-assisted development. It keeps your projects, ideas, agent tasks, isolated Git worktrees, and code review together, so you can follow work from intent to result.',
  ],
  [
    'Do I need an AI subscription?',
    'You bring your own locally installed, signed-in coding agents. The initial Windows release focuses on Codex and Claude Code. Their account requirements, subscriptions, and usage limits still apply; Jackalope does not include model access.',
  ],
  [
    'Does my code stay on my computer?',
    'Your repositories and task workspaces live on your computer. When you run an agent, it may send code and context to its provider under your account settings. Any connected tools also have their own data policies.',
  ],
  [
    'Can agents work on different tasks at once?',
    'Yes. Parallel tasks can use isolated Git worktrees, with scopes and dependencies to coordinate the work. You can inspect the proposed changes and checks before explicitly applying an integration.',
  ],
  [
    'Which operating systems can I use?',
    'The initial release targets Windows x64. macOS and Linux are on the roadmap and are not available as supported downloads yet.',
  ],
  [
    'Can I download it today?',
    downloadUrl
      ? `The Windows release is available below. Bring a local Git repository and a supported, signed-in coding agent to get started.`
      : 'Jackalope is in development. The first Windows download is being prepared, and this page will link to it when it is published. The walkthrough shows the current interface with sample project data.',
  ],
];

export function App({ path = '/' }: { path?: string }) {
  const home = path === '/';
  const [dark, setDark] = useState(false);
  const [palette, setPalette] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [scene, setScene] = useState('tasks');
  const screenshot = (name: string) => asset(dark ? name : name.replace('.png', '-light.png'));
  const videoTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    applyThemeTokens({ ...PRESET_THEMES[palette], isDark: dark, atmosphere: 18 });
  }, [dark, palette]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a href="/" className="wordmark" aria-label="Jackalope home">
            <BrandMark />
            Jackalope
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href={home ? '#workflow' : '/#workflow'}>How it works</a>
            <a href="/changelog/" aria-current={path === '/changelog/' ? 'page' : undefined}>
              Changelog
            </a>
            <a href="/blog/" aria-current={path.startsWith('/blog/') ? 'page' : undefined}>
              Field notes
            </a>
          </nav>
          <div className="header-actions">
            <button
              className="icon-button appearance-toggle"
              type="button"
              aria-label={`Switch to ${dark ? 'light' : 'dark'} appearance`}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <DownloadButton compact />
            <Menu.Root>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  className="icon-button mobile-menu"
                  aria-label="Open navigation"
                >
                  <MenuIcon size={22} />
                </button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  className="nav-menu"
                  align="end"
                  sideOffset={12}
                  collisionPadding={16}
                >
                  {[
                    ['How it works', '/#workflow'],
                    ['Make it yours', '/#atmosphere'],
                    ['Questions', '/#questions'],
                    ['Changelog', '/changelog/'],
                    ['Field notes', '/blog/'],
                  ].map(([label, href]) => (
                    <Menu.Item key={href} asChild>
                      <a href={href}>{label}</a>
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </header>

      {home ? (
        <main id="main">
          <section className="hero page-width" aria-labelledby="hero-title">
            <h1 id="hero-title">
              Big ideas.
              <br />
              <span>Room to run.</span>
            </h1>
            <p className="hero-description">
              Your projects. Your agents. One calm place to build.
              <br className="desktop-break" /> Meet the desktop workspace that keeps it all
              together.
            </p>
            <div className="hero-actions">
              <DownloadButton />
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  videoTrigger.current = document.activeElement as HTMLElement;
                  setVideoError(false);
                  setVideoOpen(true);
                }}
              >
                <Play size={16} fill="currentColor" /> See it in motion
              </button>
            </div>
            <p className="release-note">
              {downloadUrl
                ? `Windows x64 · ${version}`
                : 'Coming first to Windows · Bring your own agents'}
            </p>

            <Reveal className="hero-product">
              <HeroSurface>
                <div className="product-caption">
                  <span>
                    <BrandMark /> YOUR NEXT CHAPTER, ALL IN ONE PLACE
                  </span>
                  <span>JACKALOPE / DESKTOP</span>
                </div>
                <button
                  className="screenshot-button"
                  type="button"
                  onClick={() => {
                    videoTrigger.current = document.activeElement as HTMLElement;
                    setVideoError(false);
                    setVideoOpen(true);
                  }}
                  aria-label="Play the Jackalope product walkthrough"
                >
                  <img
                    src={screenshot('tasks.png')}
                    alt={scenes[0].alt}
                    width="1440"
                    height="840"
                    fetchPriority="high"
                  />
                  <span className="play-pill">
                    <Play size={15} fill="currentColor" /> Take a little look
                  </span>
                </button>
              </HeroSurface>
              <div className="under-capture">
                <span>Actual app interface. Sample project.</span>
                <a href="#workflow">
                  A closer look <ArrowDown size={14} />
                </a>
              </div>
            </Reveal>
          </section>

          <section className="agent-strip page-width" aria-label="Coding agents">
            <p>A new home for the agents you already know.</p>
            <div>
              <span>
                <Code2 size={24} /> Codex
              </span>
              <span>
                <span className="claude-star" aria-hidden="true">
                  ✳
                </span>{' '}
                Claude Code
              </span>
              <span className="agent-strip-note">
                Your accounts.
                <br />
                Your way of working.
              </span>
            </div>
          </section>

          <section
            id="workflow"
            className="workflow section-space page-width"
            aria-labelledby="workflow-title"
          >
            <Reveal className="section-intro">
              <div>
                <p className="eyebrow">A CLEAR PATH FROM IDEA TO DONE</p>
                <h2 id="workflow-title">
                  Less keeping track.
                  <br />
                  More moving forward.
                </h2>
              </div>
              <p>
                Start with your local Git project and a signed-in coding agent. Here’s how an idea
                becomes work you can review.
              </p>
            </Reveal>
            <ol className="getting-started" aria-label="How to use Jackalope">
              <li>
                <span className="step-number" aria-hidden="true">
                  01
                </span>
                <h3>Open your project.</h3>
                <p>
                  Choose a local Git repository. Keep its branch, guidelines, and context close.
                </p>
              </li>
              <li>
                <span className="step-number" aria-hidden="true">
                  02
                </span>
                <h3>Give an agent a task.</h3>
                <p>
                  Open <strong>New task</strong>, choose your agent, and describe the outcome. Use
                  an isolated worktree for room to experiment.
                </p>
              </li>
              <li>
                <span className="step-number" aria-hidden="true">
                  03
                </span>
                <h3>Review what comes back.</h3>
                <p>
                  Read the result, inspect the patch, and run your checks. Ask for changes or decide
                  what to integrate.
                </p>
              </li>
            </ol>
            <Tabs.Root value={scene} onValueChange={setScene} className="product-tour">
              <Tabs.List className="tour-tabs" aria-label="Explore the workspace">
                {scenes.map((item) => (
                  <Tabs.Trigger key={item.id} value={item.id}>
                    {item.label}
                    <ArrowRight size={18} />
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              {scenes.map((item) => (
                <Tabs.Content value={item.id} key={item.id} className="tour-panel">
                  <div className="tour-copy">
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                  <ul className="feature-callouts" aria-label={`${item.label} features`}>
                    {item.features.map((feature) => (
                      <li key={feature}>
                        <Check size={14} aria-hidden="true" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <img
                    src={screenshot(item.image)}
                    alt={item.alt}
                    width="1440"
                    height="840"
                    loading="lazy"
                  />
                  <p className="capture-note">Actual app interface · Atlas sample project</p>
                </Tabs.Content>
              ))}
            </Tabs.Root>
          </section>

          <section className="control-section section-space" aria-labelledby="control-title">
            <div className="page-width control-layout">
              <Reveal className="control-copy">
                <p className="eyebrow">SPACE TO EXPLORE. CONTROL TO SHIP.</p>
                <h2 id="control-title">
                  Let them branch out.
                  <br />
                  Keep the final say.
                </h2>
                <p>
                  Give your agents room to work in separate Git worktrees. Follow their progress,
                  answer a question, and review what changed when it’s ready.
                </p>
                <a className="text-link" href="#download">
                  Build on your terms <ArrowRight size={17} />
                </a>
              </Reveal>
              <Reveal className="branch-story">
                <div className="branch-main">
                  <GitBranch size={18} />
                  <span>Your project</span>
                  <code>main</code>
                </div>
                <div className="branch-forks">
                  <div>
                    <Code2 />
                    <span>
                      Improve search<small>Codex · isolated worktree</small>
                    </span>
                  </div>
                  <div>
                    <span className="claude-star" aria-hidden="true">
                      ✳
                    </span>
                    <span>
                      Polish the settings<small>Claude Code · isolated worktree</small>
                    </span>
                  </div>
                </div>
                <div className="branch-review">
                  <Check size={18} />
                  <div>
                    Back to you for review
                    <small>Inspect changes. Run checks. Decide what lands.</small>
                  </div>
                </div>
                <p className="capture-note">An example of how your work can flow.</p>
              </Reveal>
            </div>
          </section>

          <section
            id="atmosphere"
            className="atmosphere section-space page-width"
            aria-labelledby="atmosphere-title"
          >
            <Reveal className="atmosphere-art">
              <div className="mini-window">
                <div className="mini-chrome">
                  <BrandMark />
                  <span>Your little corner of focus.</span>
                  <span aria-hidden="true">—</span>
                </div>
                <div className="mini-canvas">
                  <BrandMark className="big-mark" />
                  <p>Something good starts here.</p>
                  <span>A place for your next idea.</span>
                  <div className="mini-input">
                    <span>What would you like to make?</span>
                    <Plus size={18} />
                  </div>
                </div>
              </div>
              <span className="art-label">SAME WORKSPACE. A DIFFERENT FEELING.</span>
            </Reveal>
            <Reveal className="atmosphere-copy">
              <p className="eyebrow">A WORKSPACE THAT FEELS LIKE YOU</p>
              <h2 id="atmosphere-title">
                Find your
                <br />
                kind of calm.
              </h2>
              <p>
                Warm and mellow. Cool and collected. Make the atmosphere your own, with thoughtful
                color and light that carry through the whole app.
              </p>
              <fieldset className="palette-options" aria-label="Try a color palette">
                {PRESET_THEMES.slice(0, 4).map((theme, index) => (
                  <button
                    key={theme.id}
                    type="button"
                    style={{ '--swatch': theme.accentHex } as CSSProperties}
                    className="palette-button"
                    aria-label={theme.name}
                    aria-pressed={index === palette}
                    onClick={() => setPalette(index)}
                  >
                    {index === palette && <Check size={17} />}
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
                <span>Go on. Try it here.</span>
              </fieldset>
            </Reveal>
          </section>

          <section className="details-row page-width" aria-label="Thoughtful by design">
            <div>
              <Layers3 size={22} />
              <h3>Your project instructions.</h3>
              <p>
                Keep the original brief and repository guidelines beside the task that needs them.
              </p>
            </div>
            <div>
              <Monitor size={22} />
              <h3>Your local repositories.</h3>
              <p>
                Work with your local repositories and coding agents, in a dedicated desktop
                workspace.
              </p>
            </div>
            <div>
              <GitBranch size={22} />
              <h3>A history you can follow.</h3>
              <p>
                Follow an idea through its attempts, results, and review. Pick up with the context
                intact.
              </p>
            </div>
          </section>

          <section
            id="questions"
            className="questions section-space page-width"
            aria-labelledby="questions-title"
          >
            <Reveal>
              <p className="eyebrow">A FEW THINGS TO KNOW</p>
              <h2 id="questions-title">Curious by nature.</h2>
              <p>So are we.</p>
              <BrandMark className="questions-mark" />
            </Reveal>
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

          <section id="download" className="download-section" aria-labelledby="download-title">
            <div className="page-width">
              <BrandMark className="download-mark" />
              <p className="eyebrow">MAKE ROOM FOR WHAT’S NEXT</p>
              <h2 id="download-title">
                Your next idea
                <br />
                looks good from here.
              </h2>
              <p>A little structure. A lot of possibility. That’s Jackalope.</p>
              {downloadUrl ? (
                <a className="button button-primary button-download" href={downloadUrl}>
                  <ArrowDownToLine size={18} />
                  <span>Download for Windows</span>
                </a>
              ) : (
                <WaitlistButton />
              )}
              <p className="release-note">
                {downloadUrl
                  ? `Version ${version} · Windows x64 · Bring your own agents`
                  : 'In development · Windows x64 first · macOS & Linux planned'}
              </p>
            </div>
          </section>
          <JournalTeaser />
        </main>
      ) : (
        <JournalPage path={path} />
      )}

      {path !== '/privacy/' && <Newsletter />}

      <footer className="site-footer page-width">
        <a href="/" className="wordmark">
          <BrandMark />
          Jackalope
        </a>
        <p>
          A product of <a href="https://jackalope.digital">Jackalope Digital LLC</a>.
        </p>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="/changelog/">Changelog</a>
          <a href="/blog/">Field notes</a>
          <a href="/privacy/">Privacy</a>
          <a href="/#questions">Questions</a>
        </nav>
      </footer>

      <Dialog.Root open={videoOpen} onOpenChange={setVideoOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="video-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              videoTrigger.current?.focus({ preventScroll: true });
            }}
          >
            <div className="video-heading">
              <div>
                <Dialog.Title>A little look around.</Dialog.Title>
                <Dialog.Description>
                  The actual app, with an illustrative Atlas project. No audio.
                </Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="Close walkthrough">
                <X size={22} />
              </Dialog.Close>
            </div>
            {videoError ? (
              <div className="video-error">
                <p>The walkthrough couldn’t load. You can still explore the app screenshots.</p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    setVideoOpen(false);
                    document.getElementById('workflow')?.scrollIntoView();
                  }}
                >
                  Explore the workspace
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <video
                controls
                playsInline
                preload="metadata"
                poster={screenshot('tasks.png')}
                onError={() => setVideoError(true)}
              >
                <source
                  src={asset('walkthrough.webm')}
                  type="video/webm"
                  onError={() => setVideoError(true)}
                />
                <track
                  kind="captions"
                  src={asset('walkthrough.vtt')}
                  srcLang="en"
                  label="English descriptions"
                />
              </video>
            )}
            <p className="video-transcript">
              The tour: switch views, draft a task, inspect a code patch and its checks, meet your
              agents, then try a different palette and appearance. Sample data illustrates the
              workflow; no task is launched in this recording.
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
