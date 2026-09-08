import { applyThemeTokens, DEFAULT_THEME, PRESET_THEMES } from '@jackalope/brand/theme';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowDownToLine, ArrowRight, Menu as MenuIcon, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccessPage } from './Access';
import { BrandMark } from './BrandMark';
import { tour } from './content';
import { FeedbackPage } from './Feedback';
import { JournalPage } from './Journal';
import { LandingPage } from './LandingPage';
import { LegalPage } from './Legal';
import { MarketingPage } from './MarketingPage';
import { marketingPages } from './marketing-content';
import { waitlistReferral } from './referral';
import { Newsletter, WaitlistButton } from './Signup';
import { WaitlistPage } from './Waitlist';

const downloadUrl = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL?.trim();
const version = import.meta.env.VITE_RELEASE_VERSION?.trim();

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

const faqs = [
  [
    'What is Jackalope?',
    'Jackalope is a cross-platform workspace for agent-assisted development. It keeps your projects, ideas, agent tasks, isolated Git worktrees, and code review together, so you can follow work from intent to result.',
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
    'Which platforms are planned?',
    'Our first launch is planned for macOS, Windows, and Linux. We are preparing and testing the builds together. Join the waitlist to hear when access opens.',
  ],
  [
    'Do direct invitations skip the waitlist?',
    'Yes. A valid direct invitation grants early access after you verify your email, while the inviter has capacity. There is no second manual approval. Approved access and download availability are separate.',
  ],
  ['When will Jackalope be available?', 'Coming soon. Join the waitlist for early-access news.'],
  [
    'Does Jackalope automatically choose the best agent, model, and account?',
    'Automatic tasks ask your configured default agent to choose an allowed agent, configured model, and permitted account. Jackalope validates project restrictions and tool compatibility, considers available capacity reports, and can hand off recognized quota failures to an eligible alternative while preserving the work. Explicit assignments remain available. “Best” depends on your setup and the evidence available; unknown quota stays unknown. This prerelease implementation has passed simulated handoff tests; live model-selection and cross-provider handoff acceptance are still pending.',
    'routing-question',
  ],
  [
    'Which tools does Jackalope give agents?',
    'Browse the MCP directory and choose project connections. Selected stdio and HTTP tools support on-demand discovery; direct connection support varies by agent. Built-in tools cover browser interaction, screenshots, accessibility audits, questions, and local verification. Windows desktop control adds accessibility snapshots, window captures, focus, clicks, typing, and scrolling after you select a window for that attempt. Stop revokes access. It operates your live desktop under existing OS permissions; macOS and Linux native window control are not yet supported. Windows fixture testing has passed; installed-agent acceptance is still pending.',
    'tools-question',
  ],
  [
    'How do different agents communicate and stay up to date?',
    'Tasks share a project inventory with ownership, scopes, dependencies, and messages. Agents can send direct task messages or project broadcasts. Jackalope supplies a bounded briefing at launch and continuation, then attaches relevant updates to its own tool responses. Agents can check the durable inbox between those checkpoints. Delivery does not guarantee that an agent has read or acted on an update, and messages do not automatically wake agents, approve changes, or merge work.',
    'coordination-question',
  ],
  [
    'What happens after I join the waitlist?',
    'Verify your email to see your place and share a personal link. Waitlist referrals are unlimited; each verified new signup earns one day of priority. After acceptance, you get five Instant Access Passes for people to skip the line. No payment is needed to join, and there is no confirmed public launch date or price yet. Your coding agent’s own subscription and usage charges still apply.',
  ],
  [
    'Can I download it today?',
    downloadUrl
      ? `The Windows release is available below. Bring a local Git repository and a supported, signed-in coding agent to get started.`
      : 'Jackalope is in early development, and the first public download is being prepared. Join the waitlist for access news. The interactive demo uses sample tasks; the app walkthrough shows the current interface with sample project data.',
  ],
];

export function App({ path = '/' }: { path?: string }) {
  useEffect(() => {
    waitlistReferral();
  }, []);
  const home = path === '/';
  const marketingPage = marketingPages.find((page) => page.path === path);
  const [dark, setDark] = useState(false);
  const [palette, setPalette] = useState(() =>
    PRESET_THEMES.findIndex((theme) => theme.id === DEFAULT_THEME.id),
  );
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    applyThemeTokens({ ...PRESET_THEMES[palette], isDark: dark, atmosphere: 18 });
  }, [dark, palette]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`site-header${home ? ' landing-header' : ''}`}>
        <div className="header-inner">
          <a href="/" className="wordmark" aria-label="Jackalope home">
            <BrandMark />
            Jackalope
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href={home ? '#inside' : '/#inside'}>Product</a>
            <a href="/compare/">Compare</a>
            <a href="/agents/" aria-current={path.startsWith('/agents/') ? 'page' : undefined}>
              Agents
            </a>
            <a href="/blog/" aria-current={path.startsWith('/blog/') ? 'page' : undefined}>
              Field notes
            </a>
          </nav>
          <div className="header-actions">
            {path !== '/access/' && (
              <a className="member-entry" href="/access/">
                Member access
              </a>
            )}
            <button
              className="icon-button appearance-toggle"
              type="button"
              aria-label={`Switch to ${dark ? 'light' : 'dark'} appearance`}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {path === '/access/' || path === '/feedback/' ? (
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
                  <Menu.Item onSelect={() => setDark(!dark)}>
                    Switch to {dark ? 'light' : 'dark'} appearance
                  </Menu.Item>
                  {[
                    ['Your waitlist place', '/waitlist/'],
                    ['Member access', '/access/'],
                    ['Compare workflows', '/compare/'],
                    ['Product tour', '/#inside'],
                    ['Parallel coding agents', '/parallel-coding-agents/'],
                    ['Git worktrees for agents', '/git-worktrees-for-ai-agents/'],
                    ['Supported agents', '/agents/'],
                    ['Review AI-generated code', '/guides/review-ai-generated-code/'],
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
        <LandingPage
          available={Boolean(downloadUrl)}
          releaseVersion={version}
          action={<DownloadButton />}
          downloadAction={
            downloadUrl ? (
              <a className="button button-primary button-download" href={downloadUrl}>
                Download for Windows <ArrowDownToLine size={18} />
              </a>
            ) : (
              <WaitlistButton />
            )
          }
          dark={dark}
          setDark={setDark}
          palette={palette}
          setPalette={setPalette}
          onPlay={() => {
            videoTrigger.current = document.activeElement as HTMLElement;
            setVideoError(false);
            setVideoOpen(true);
          }}
          faqs={faqs}
        />
      ) : path === '/feedback/' ? (
        <FeedbackPage />
      ) : path === '/waitlist/' ? (
        <WaitlistPage />
      ) : path === '/access/' ? (
        <AccessPage />
      ) : path === '/privacy/' || path === '/terms/' ? (
        <LegalPage kind={path === '/privacy/' ? 'privacy' : 'terms'} />
      ) : marketingPage ? (
        <MarketingPage page={marketingPage} dark={dark} />
      ) : (
        <JournalPage path={path} />
      )}

      {!['/', '/privacy/', '/terms/', '/access/', '/waitlist/', '/feedback/'].includes(path) && (
        <Newsletter />
      )}

      <footer className={`site-footer ${home ? 'landing-footer' : 'page-width'}`}>
        <a href="/" className="wordmark">
          <BrandMark />
          Jackalope
        </a>
        <p>
          A product of <a href="https://jackalope.digital">Jackalope Digital LLC</a>.
        </p>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="/tour/">App tour</a>
          <a href="/parallel-coding-agents/">Parallel agents</a>
          <a href="/git-worktrees-for-ai-agents/">Git worktrees</a>
          <a href="/agents/">Agents</a>
          <a href="/changelog/">Changelog</a>
          <a href="/blog/">Field notes</a>
          <a href="https://x.com/JackalopeDotDev" rel="me">
            Follow on X
          </a>
          <a href="/waitlist/">Your waitlist place</a>
          <a href="/access/">Your access & passes</a>
          <a href="/privacy/">Privacy</a>
          <a href="/terms/">Terms</a>
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
                <Dialog.Title>Jackalope walkthrough</Dialog.Title>
                <Dialog.Description>
                  32 seconds · Animated app preview · Sample data · Music
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
                    document.getElementById('inside')?.scrollIntoView();
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
                poster={tour.poster}
                aria-label="Jackalope launch film"
                onError={() => setVideoError(true)}
              >
                <source src={tour.video} type="video/mp4" onError={() => setVideoError(true)} />
                <track
                  kind="captions"
                  src={tour.captions}
                  srcLang="en"
                  label="English descriptions"
                />
              </video>
            )}
            <p className="video-transcript">{tour.transcript}</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
