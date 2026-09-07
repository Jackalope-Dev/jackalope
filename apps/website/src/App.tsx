import { applyThemeTokens, DEFAULT_THEME, PRESET_THEMES } from '@jackalope/brand/theme';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowDownToLine, ArrowRight, Menu as MenuIcon, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccessPage } from './Access';
import { BrandMark } from './BrandMark';
import { JournalPage } from './Journal';
import { LandingPage } from './LandingPage';
import { LegalPage } from './Legal';
import { Newsletter, WaitlistButton } from './Signup';

const downloadUrl = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL?.trim();
const version = import.meta.env.VITE_RELEASE_VERSION?.trim();
const asset = (name: string) => `/media/${name}`;

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
  ['When will Jackalope be available?', 'Coming soon. Join the waitlist for early-access news.'],
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
  const [palette, setPalette] = useState(() =>
    PRESET_THEMES.findIndex((theme) => theme.id === DEFAULT_THEME.id),
  );
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
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
      <header className={`site-header${home ? ' landing-header' : ''}`}>
        <div className="header-inner">
          <a href="/" className="wordmark" aria-label="Jackalope home">
            <BrandMark />
            Jackalope
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href={home ? '#workflow' : '/#workflow'}>How it works</a>
            <a href={home ? '#features' : '/#features'}>Features</a>
            <a
              href={home ? '#inside' : '/changelog/'}
              aria-current={path === '/changelog/' ? 'page' : undefined}
            >
              {home ? 'Inside the app' : 'Changelog'}
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
                    ['Features', '/#features'],
                    ['Inside the app', '/#inside'],
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
      ) : path === '/access/' ? (
        <AccessPage />
      ) : path === '/privacy/' || path === '/terms/' ? (
        <LegalPage kind={path === '/privacy/' ? 'privacy' : 'terms'} />
      ) : (
        <JournalPage path={path} dark={dark} />
      )}

      {!['/', '/privacy/', '/terms/', '/access/'].includes(path) && <Newsletter />}

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
          <a href="/changelog/">Changelog</a>
          <a href="/blog/">Field notes</a>
          <a href="/access/">Your access</a>
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
