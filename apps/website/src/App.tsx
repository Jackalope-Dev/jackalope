import { applyThemeTokens, type ThemePalette } from '@jackalope/brand/theme';
import { Button, GitHubIcon, IconButton, DropdownMenu as Menu } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, ArrowRight, Menu as MenuIcon, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccessPage } from './Access';
import { BenchmarksPage } from './Benchmarks';
import { BrandMark } from './BrandMark';
import { GITHUB_URL } from './community';
import { tour } from './content';
import { DownloadPage } from './Download';
import { desktopDownloads, downloadsAvailable } from './download-config';
import { FeedbackPage } from './Feedback';
import { Footer } from './Footer';
import { JournalPage } from './Journal';
import { KnowledgebasePage } from './Knowledgebase';
import { LandingPage } from './LandingPage';
import { LegalPage } from './Legal';
import { MarketingPage } from './MarketingPage';
import { marketingPages } from './marketing-content';
import { RoadmapPage } from './Roadmap';
import { waitlistReferral } from './referral';
import { Newsletter, Signup, WaitlistButton } from './Signup';
import { TourPage } from './TourPage';
import { DEFAULT_WEBSITE_THEME, readWebsiteTheme, saveWebsiteTheme } from './theme';
import { setInitialVideoVolume } from './video-volume';
import { WaitlistPage } from './Waitlist';
import './knowledge.css';

function DownloadButton({ compact = false }: { compact?: boolean }) {
  if (!downloadsAvailable) return <WaitlistButton compact={compact} />;
  return (
    <a
      className={`button button-primary button-download ${compact ? 'button-compact' : ''}`}
      href="/download/"
    >
      <span>Get Jackalope</span>
      <ArrowDownToLine size={16} />
    </a>
  );
}

const platforms = desktopDownloads.some((platform) => platform.id === 'windows' && platform.url)
  ? 'Windows, macOS and Linux'
  : 'macOS and Linux';

const faqs = [
  [
    'What is Jackalope?',
    'Jackalope is a desktop workspace for AI coding agents, including Codex, Claude Code, Gemini CLI, Grok, OpenCode, Kimi Code and Antigravity. Run tasks in parallel, each in its own Git worktree, keep their project context together, and review the changes in one place.',
  ],
  [
    'How do I get access?',
    'Join the waitlist and verify your email. We are approving new members quickly and will email you when your account is approved; then sign in to the desktop app. A direct invitation or a claimed Instant Access Pass skips the wait. Each verified signup through your referral link earns a day of priority, and approved members receive five passes to share. No payment is needed to join.',
  ],
  [
    'Can I download Jackalope now?',
    `Yes. Builds for ${platforms} are on the download page. Signing in to the app requires an approved waitlist spot or a claimed Instant Access Pass.`,
  ],
  [
    'Why use it instead of more terminal tabs?',
    'Each task keeps its brief, agent, account, worktree, questions and result together. You can see what needs attention and review related changes as one combined patch.',
  ],
  [
    'Do I need an AI subscription?',
    'Bring a supported agent CLI and its provider account. Jackalope does not include model access. Subscription requirements, usage limits and charges depend on your provider.',
  ],
  [
    'Does my code stay on my computer?',
    'Repositories and task workspaces live on your computer. Agents may send code and context to their providers under your account settings. Connected tools have their own data policies.',
  ],
  [
    'Can I keep work and personal accounts separate?',
    'Yes. Create named account profiles and choose project defaults. Continuations retain their selected profile. Antigravity profiles use Gemini API keys; its existing subscription login is shared. Profiles do not isolate local file access.',
  ],
  [
    'Can Jackalope choose an agent, model and account?',
    'Yes. Choose local rules, agent-powered reasoning or optional Jev-assisted decisions, with project overrides. Local rules use no model call. Routing respects allowed agents, configured models, accounts, tool compatibility and reported capacity, and recognized quota failures can hand off to an eligible alternative. You can always assign an agent yourself.',
    'routing-question',
  ],
  [
    'Which tools does Jackalope give agents?',
    'Connect MCP tools from the directory for each project. Built-in tools cover browser interaction, screenshots, accessibility audits, questions and local checks. On Windows, an agent can control an app window you select; a status bar shows when control is active, mouse or keyboard activity pauses it, and Escape revokes it. Desktop control on macOS and Linux is still in validation.',
    'tools-question',
  ],
  [
    'How do agents stay in sync with each other?',
    'Tasks share a project inventory with ownership, scopes, dependencies and messages. Agents get a briefing at launch and continuation, can message each other, and receive relevant updates through Jackalope tools. Messages do not automatically wake agents, approve changes or merge work.',
    'coordination-question',
  ],
];

export function App({ path = '/' }: { path?: string }) {
  useEffect(() => {
    waitlistReferral();
  }, []);
  const home = path === '/';
  const marketingPage = marketingPages.find((page) => page.path === path);
  const [theme, setTheme] = useState<ThemePalette>(DEFAULT_WEBSITE_THEME);
  const dark = theme.isDark;
  const updateTheme = (next: ThemePalette) => {
    applyThemeTokens(next);
    saveWebsiteTheme(next);
    setTheme(next);
  };
  const setDark = (isDark: boolean) => updateTheme({ ...theme, isDark });
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setTheme(readWebsiteTheme());
  }, []);

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
            <a href="/knowledge/" aria-current={path.startsWith('/knowledge') ? 'page' : undefined}>
              Knowledgebase
            </a>
            <a href="/blog/" aria-current={path.startsWith('/blog/') ? 'page' : undefined}>
              Field notes
            </a>
            <a href="/download/" aria-current={path === '/download/' ? 'page' : undefined}>
              Download
            </a>
          </nav>
          <div className="header-actions">
            {path !== '/access/' && (
              <a className="member-entry" href="/access/">
                Member access
              </a>
            )}
            <a
              className="icon-button github-link"
              href={GITHUB_URL}
              aria-label="Jackalope on GitHub"
            >
              <GitHubIcon size={18} />
            </a>
            <IconButton
              className="icon-button appearance-toggle"
              type="button"
              label={`Switch to ${dark ? 'light' : 'dark'} appearance`}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
            {path === '/access/' || path === '/feedback/' || path === '/download/' ? (
              <a className="text-link" href="/tour/">
                Take a look around <ArrowRight size={15} />
              </a>
            ) : (
              <DownloadButton compact />
            )}
            <Menu.Root>
              <Menu.Trigger asChild>
                <IconButton
                  type="button"
                  className="icon-button mobile-menu"
                  label="Open navigation"
                >
                  <MenuIcon size={22} />
                </IconButton>
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
                    ['Download Jackalope', '/download/'],
                    ['Your waitlist place', '/waitlist/'],
                    ['Member access', '/access/'],
                    ['Compare workflows', '/compare/'],
                    ['Product tour', '/tour/'],
                    ['Knowledgebase & Guides', '/knowledge/'],
                    ['Parallel coding agents', '/parallel-coding-agents/'],
                    ['Git worktrees for agents', '/git-worktrees-for-ai-agents/'],
                    ['Supported agents', '/agents/'],
                    ['Review AI-generated code', '/guides/review-ai-generated-code/'],
                    ['Questions', '/#questions'],
                    ['Changelog', '/changelog/'],
                    ['Roadmap', '/roadmap/'],
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
          waitlistAction={<WaitlistButton />}
          signup={<Signup />}
          platforms={platforms}
          dark={dark}
          onPlay={() => {
            videoTrigger.current = document.activeElement as HTMLElement;
            setVideoError(false);
            setVideoOpen(true);
          }}
          faqs={faqs}
        />
      ) : path === '/tour/' ? (
        <TourPage dark={dark} />
      ) : path === '/download/' ? (
        <DownloadPage />
      ) : path === '/feedback/' ? (
        <FeedbackPage />
      ) : path === '/waitlist/' ? (
        <WaitlistPage />
      ) : path === '/access/' ? (
        <AccessPage />
      ) : path.startsWith('/knowledge/') ? (
        <KnowledgebasePage path={path} dark={dark} />
      ) : path === '/privacy/' || path === '/terms/' ? (
        <LegalPage kind={path === '/privacy/' ? 'privacy' : 'terms'} />
      ) : path === '/roadmap/' ? (
        <RoadmapPage />
      ) : path === '/benchmarks/' ? (
        <BenchmarksPage />
      ) : marketingPage ? (
        <MarketingPage page={marketingPage} dark={dark} />
      ) : (
        <JournalPage path={path} />
      )}

      {![
        '/',
        '/tour/',
        '/download/',
        '/privacy/',
        '/terms/',
        '/access/',
        '/waitlist/',
        '/feedback/',
        '/roadmap/',
      ].includes(path) && <Newsletter />}

      <Footer home={home} path={path} />

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
                <Dialog.Description className="sr-only">
                  Explore the Jackalope workspace.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton className="icon-button" label="Close walkthrough">
                  <X size={22} />
                </IconButton>
              </Dialog.Close>
            </div>
            {videoError ? (
              <div className="video-error">
                <p>The walkthrough couldn’t load. You can still explore the app screenshots.</p>
                <Button
                  variant="primary"
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    setVideoOpen(false);
                    document.getElementById('inside')?.scrollIntoView();
                  }}
                >
                  Explore the workspace
                  <ArrowRight size={16} />
                </Button>
              </div>
            ) : (
              <video
                onLoadedMetadata={setInitialVideoVolume}
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
