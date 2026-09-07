import { applyThemeTokens, PRESET_THEMES } from '@jackalope/brand/theme';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDownToLine,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Code2,
  GitBranch,
  Layers3,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Play,
  Plus,
  Sprout,
  Sun,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { AccessPage } from './Access';
import { AgentSupport } from './AgentSupport';
import { BrandMark } from './BrandMark';
import { JournalPage, JournalTeaser } from './Journal';
import { Newsletter, WaitlistButton } from './Signup';
import { WorkflowDemo } from './WorkflowDemo';

const downloadUrl = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL?.trim();
const version = import.meta.env.VITE_RELEASE_VERSION?.trim();
const asset = (name: string) => `/media/${name}`;

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
      <span>Get Jackalope</span>
      <ArrowDownToLine size={16} />
    </a>
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
      'Choose a supported coding agent, keep your existing accounts, and give each task the right context.',
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
    'Bring Codex, Claude Code, Grok, or OpenCode. Jackalope uses their installed command-line interfaces; see the agent section for connection and sign-in differences. Provider account requirements, subscriptions, and usage limits still apply. Jackalope does not include model access.',
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
    'Can I keep work and personal accounts separate?',
    'Yes. Create separate sign-in profiles for supported agents such as Codex and Claude Code, then choose an account and allowed agents for each project. Task continuations keep their original account. Profiles organize sign-ins and project context; they are not a security sandbox. Provider settings, connected tools, and local file permissions still apply.',
  ],
  [
    'What can I see across my accounts?',
    'Follow task progress and review changes in one workspace. In Usage, filter Jackalope attempts by project and account, inspect reported token usage, and export the selected records. Missing reports remain unavailable; this is not a complete provider billing history or a record of work done outside Jackalope.',
  ],
  [
    'Which operating systems can I use?',
    'Windows, macOS, and Linux users are welcome on the waitlist. Windows x64 is the first release target; macOS and Linux are planned. We’ll announce each platform as its download becomes available.',
  ],
  [
    'What happens after I join the waitlist?',
    'We’ll email you about early access as places open up. No payment is needed to join, and there is no confirmed public launch date or price yet. Your coding agent’s own subscription and usage charges still apply.',
  ],
  [
    'Can I download it today?',
    downloadUrl
      ? `The Windows release is available below. Bring a local Git repository and a supported, signed-in coding agent to get started.`
      : 'Jackalope is in early development, and the first public download is being prepared. Join the waitlist for access news. The interactive demo uses sample tasks; the app walkthrough shows the current interface with sample project data.',
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
            {path === '/access/' ? (
              <a className="text-link" href="/tour/">
                Take a look around <ArrowRight size={15} />
              </a>
            ) : (
              <DownloadButton compact />
            )}
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
            <div className="hero-copy">
              <h1 id="hero-title">
                Big ideas.
                <br />
                <span>Room to run.</span>
              </h1>
              <p className="hero-description">
                A desktop home for agent-assisted development. Give Codex, Claude Code, Grok, or
                OpenCode a task, run work in parallel, and review the changes in one place.
              </p>
              <div className="hero-actions">
                <DownloadButton />
                <a className="button button-quiet" href="#playground">
                  Try the workflow <ArrowRight size={16} />
                </a>
                <button
                  type="button"
                  className="text-link hero-video-link"
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
                  : 'Windows first · macOS & Linux planned · Bring your own agent access'}
              </p>
            </div>
            <figure className="hero-stage" aria-label="An example journey from idea to code review">
              <BrandMark className="hero-silhouette" />
              <div className="hero-brief">
                <span className="hero-art-label">ATLAS / NEW TASK</span>
                <p>“Make search feel effortless.”</p>
                <span>
                  Atlas project <span aria-hidden="true">/</span> Your instructions & tools
                </span>
              </div>
              <div className="hero-agent-lanes">
                <div>
                  <Code2 size={18} />
                  <strong>Codex</strong>
                  <span>Build the keyboard flow</span>
                </div>
                <div>
                  <span className="claude-star" aria-hidden="true">
                    ✳
                  </span>
                  <strong>Claude Code</strong>
                  <span>Polish the experience</span>
                </div>
              </div>
              <div className="hero-review">
                <div className="hero-review-heading">
                  <GitBranch size={17} />
                  <span>Separate worktrees. One place to review.</span>
                </div>
                <img
                  src={screenshot('review.png')}
                  alt="Jackalope’s actual review screen with a search patch and project checks in the Atlas sample project."
                  width="1440"
                  height="840"
                  fetchPriority="high"
                />
                <div className="hero-review-note">
                  <Check size={17} />
                  <span>
                    The next move is yours.
                    <small>Inspect the patch. Ask for changes. Choose what lands.</small>
                  </span>
                  <ArrowRight size={20} />
                </div>
              </div>
              <figcaption className="hero-art-caption">
                Illustrated workflow · actual app with sample data
              </figcaption>
            </figure>
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
              <span>
                <span aria-hidden="true">↗</span> Grok
              </span>
              <span>
                <Code2 size={24} /> OpenCode
              </span>
            </div>
            <a className="text-link" href="#agents">
              Explore agent support <ArrowRight size={15} />
            </a>
          </section>

          <section className="demo-section page-width" aria-labelledby="demo-title">
            <Reveal className="section-intro">
              <div>
                <h2 id="demo-title">
                  Take an idea
                  <br />
                  for a spin.
                </h2>
              </div>
              <p>
                Pick a brief, choose an agent, and follow the work through to review. An interactive
                sample of your next everyday workflow — no setup needed.
              </p>
            </Reveal>
            <WorkflowDemo />
          </section>

          <section
            id="workflow"
            className="workflow section-space page-width"
            aria-labelledby="workflow-title"
          >
            <Reveal className="section-intro">
              <div>
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
                  <button
                    className="screenshot-button"
                    type="button"
                    aria-label="Play the Jackalope product walkthrough"
                    onClick={() => {
                      videoTrigger.current = document.activeElement as HTMLElement;
                      setVideoError(false);
                      setVideoOpen(true);
                    }}
                  >
                    <img
                      src={screenshot(item.image)}
                      alt={item.alt}
                      width="1440"
                      height="840"
                      loading="lazy"
                    />
                    <span className="play-pill">
                      <Play size={15} fill="currentColor" /> Watch the walkthrough
                    </span>
                  </button>
                  <p className="capture-note">Actual app interface · Atlas sample project</p>
                </Tabs.Content>
              ))}
            </Tabs.Root>
          </section>

          <section
            id="accounts"
            className="accounts-section section-space page-width"
            aria-labelledby="accounts-title"
          >
            <Reveal className="accounts-intro">
              <h2 id="accounts-title">
                Work and personal.
                <br />
                Each in its own context.
              </h2>
              <p>
                Bring your accounts into one workspace. Give each project its own agent choices,
                sign-in profile, and instructions — then follow the work without juggling windows.
              </p>
            </Reveal>
            <Reveal className="accounts-example">
              <div className="accounts-lanes">
                {[
                  { name: 'Work', project: 'Client project', icon: BriefcaseBusiness },
                  { name: 'Personal', project: 'Side project', icon: Sprout },
                ].map(({ name, project, icon: Icon }) => (
                  <div className="account-lane" key={name}>
                    <div className="account-lane-heading">
                      <Icon size={20} aria-hidden="true" />
                      <h3>{name}</h3>
                    </div>
                    <dl>
                      <div>
                        <dt>Project</dt>
                        <dd>{project}</dd>
                      </div>
                      <div>
                        <dt>Agent account</dt>
                        <dd>Codex · {name}</dd>
                      </div>
                      <div>
                        <dt>Context</dt>
                        <dd>Project instructions & selected tools</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
              <p className="accounts-shared">
                <Layers3 size={18} aria-hidden="true" />
                One place to follow tasks, review changes, and inspect usage.
              </p>
              <p className="capture-note">
                Example organization · separate sign-in profiles for the same agent
              </p>
            </Reveal>
            <Reveal className="accounts-benefits">
              <div>
                <h3>The right account, remembered.</h3>
                <p>
                  Set an account per project. Continuing a task keeps the account it started with.
                </p>
              </div>
              <div>
                <h3>Context you can choose.</h3>
                <p>
                  Choose which agents a project can use, add its instructions, and select task
                  tools.
                </p>
              </div>
              <div>
                <h3>A clear view of the work.</h3>
                <p>
                  Filter reported usage by project and account. Inspect attempts, export records,
                  and review what changed.
                </p>
              </div>
            </Reveal>
            <a className="text-link" href="/blog/work-and-personal-accounts/">
              See how to set up your accounts <ArrowRight size={17} />
            </a>
          </section>

          <AgentSupport />
          <section className="control-section section-space" aria-labelledby="control-title">
            <div className="page-width control-layout">
              <Reveal className="control-copy">
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
              </fieldset>
            </Reveal>
          </section>

          <section className="details-row page-width" aria-label="Thoughtful by design">
            <div>
              <Layers3 size={22} />
              <h3>Context that stays with you.</h3>
              <p>
                Keep project instructions, reusable workflows, and lessons close. Give the next task
                a better starting point.
              </p>
            </div>
            <div>
              <Monitor size={22} />
              <h3>Your tools, in reach.</h3>
              <p>
                Manage project connections in one place and choose the tools a task needs.
                Connection support varies by agent.
              </p>
            </div>
            <div>
              <GitBranch size={22} />
              <h3>A rhythm for recurring work.</h3>
              <p>
                Schedule repeat tasks with their project context intact. Jackalope runs them while
                the app and your computer are awake.
              </p>
            </div>
          </section>

          <section
            id="questions"
            className="questions section-space page-width"
            aria-labelledby="questions-title"
          >
            <Reveal>
              <h2 id="questions-title">Common questions</h2>
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
              <h2 id="download-title">
                Your next idea
                <br />
                looks good from here.
              </h2>
              <p>Less juggling terminals. More room for the work you care about.</p>
              <section className="platform-roadmap" aria-label="Platform availability">
                <span>
                  <Monitor size={16} />
                  Windows <small>{downloadUrl ? 'Available' : 'First release'}</small>
                </span>
                <span>
                  macOS <small>Planned</small>
                </span>
                <span>
                  Linux <small>Planned</small>
                </span>
              </section>
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
                  : 'Early access · Windows first · macOS & Linux planned'}
              </p>
            </div>
          </section>
          <JournalTeaser />
        </main>
      ) : path === '/access/' ? (
        <AccessPage />
      ) : (
        <JournalPage path={path} dark={dark} />
      )}

      {path !== '/privacy/' && path !== '/access/' && <Newsletter />}

      <footer className="site-footer page-width">
        <a href="/" className="wordmark">
          <BrandMark />
          Jackalope
        </a>
        <p>
          A product of <a href="https://jackalope.digital">Jackalope Digital LLC</a>.
        </p>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="/tour/">App tour</a>
          <a href="/changelog/">Changelog</a>
          <a href="/blog/">Field notes</a>
          <a href="/access/">Your access</a>
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
