import { ArrowRight, GitBranch } from 'lucide-react';
import { posts, tour, updates } from './content';
import { PublishedReleases } from './PublishedReleases';

const publishedVersion = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL
  ? import.meta.env.VITE_RELEASE_VERSION
  : undefined;

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

export function JournalTeaser() {
  return (
    <section className="journal-teaser page-width" aria-labelledby="notes-title">
      <div className="journal-section-heading">
        <div>
          <p className="eyebrow">FROM THE STUDIO</p>
          <h2 id="notes-title">A few field notes.</h2>
        </div>
        <a className="text-link" href="/blog/">
          All notes <ArrowRight size={16} />
        </a>
      </div>
      <div className="notes-grid">
        {posts.map((post, index) => (
          <a className="note-preview" href={`/blog/${post.slug}/`} key={post.slug}>
            <div className={`note-art note-art-${index}`} aria-hidden="true">
              <span className="note-orbit" />
              <span className="note-seed" />
              <span className="note-art-label">
                {index === 0 ? 'Room to think.' : 'Idea → explore → review.'}
              </span>
              <span className="note-index">0{index + 1}</span>
            </div>
            <div className="note-meta">
              {post.category}
              <span>{post.readingTime}</span>
            </div>
            <h3>{post.title}</h3>
            <p>{post.description}</p>
            <span className="text-link">
              Read the note <ArrowRight size={16} />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function JournalPage({ path, dark = false }: { path: string; dark?: boolean }) {
  if (path === '/tour/')
    return (
      <main id="main" className="article page-width">
        <nav className="article-breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Jackalope</a>
          <span aria-hidden="true">/</span>
          <span>App tour</span>
        </nav>
        <header className="article-heading">
          <h1>{tour.title}</h1>
          <p className="article-deck">
            From an idea to a patch you can review. See how the workspace feels.
          </p>
          <p className="article-byline">33 seconds · No audio · Illustrative Atlas project</p>
        </header>
        <video
          className="tour-player"
          controls
          playsInline
          preload="metadata"
          poster={`/media/tasks${dark ? '' : '-light'}.png`}
          aria-label="Jackalope desktop app tour"
        >
          <source src="/media/walkthrough.webm" type="video/webm" />
          <track
            kind="captions"
            src="/media/walkthrough.vtt"
            srcLang="en"
            label="English descriptions"
          />
          <a href="/media/walkthrough.webm">Watch the tour recording</a>
        </video>
        <div className="article-body">
          <section>
            <h2>What happens in the tour</h2>
            <p>{tour.transcript}</p>
          </section>
          <section>
            <h2>Try this workflow with your own project</h2>
            <p>
              Start with a local Git repository and a configured coding agent, such as Codex or
              Claude Code. Describe the outcome, follow the attempt, and inspect the result before
              integrating changes. You bring your existing agent accounts and subscriptions.
            </p>
            <p>
              <a href="/blog/from-brief-to-review/">Read the guide from brief to review</a> for the
              full workflow.
            </p>
          </section>
          <section>
            <h2>When can I download Jackalope?</h2>
            <p>
              {publishedVersion ? (
                <>
                  <a href="/#download">Jackalope {publishedVersion} for Windows</a> is available.
                </>
              ) : (
                'The first public Windows x64 installer is being prepared.'
              )}{' '}
              macOS and Linux are planned. <a href="/#newsletter">Join the waitlist</a> for launch
              news, or <a href="/changelog/">follow the development changelog</a>.
            </p>
          </section>
        </div>
      </main>
    );
  const post = posts.find((item) => path === `/blog/${item.slug}/`);
  if (post)
    return (
      <main id="main" className="article page-width">
        <nav className="article-breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Jackalope</a>
          <span aria-hidden="true">/</span>
          <a href="/blog/">Field notes</a>
        </nav>
        <header className="article-heading">
          <p className="eyebrow">{post.category}</p>
          <h1>{post.title}</h1>
          <p className="article-deck">{post.description}</p>
          <div className="article-byline">
            Jackalope Digital LLC <span>·</span>{' '}
            <time dateTime={post.date}>{dateLabel(post.date)}</time>
            <span>·</span>
            {post.readingTime}
          </div>
        </header>
        <div className="article-body">
          {post.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </section>
          ))}
          <a className="text-link" href="/changelog/">
            Follow what’s taking shape <ArrowRight size={16} />
          </a>
          <p>
            <a href="/tour/">Watch the app tour</a> or{' '}
            <a href="/#workflow">explore the task workspace</a>.
          </p>
        </div>
      </main>
    );
  if (path === '/changelog/')
    return (
      <main id="main" className="journal-page page-width">
        <header className="journal-heading">
          <p className="eyebrow">A WORK IN PROGRESS, WITH INTENTION</p>
          <h1>Taking shape.</h1>
          <p>
            Small refinements. Meaningful steps forward.
            <br />
            Development notes and, when they’re ready, public releases.
          </p>
        </header>
        {publishedVersion && <PublishedReleases />}
        <div className="release-status">
          <GitBranch size={18} />
          <p>
            {publishedVersion ? (
              <>
                <strong>Jackalope {publishedVersion} is available.</strong>{' '}
                <a href="/#download">Download for Windows</a>. Earlier development milestones follow
                below.
              </>
            ) : (
              <>
                <strong>Windows is on the way.</strong> The first public installer is being
                prepared. These are development milestones, not downloadable releases.
              </>
            )}
          </p>
        </div>
        <div className="changelog-list">
          {updates.map((update) => (
            <article id={update.id} key={update.id} className="change-entry">
              <div className="change-date">
                <time dateTime={update.date}>{dateLabel(update.date)}</time>
                <span>{update.status}</span>
              </div>
              <div>
                <h2>
                  <a href={`#${update.id}`}>{update.title}</a>
                </h2>
                <p>{update.description}</p>
                <ul>
                  {update.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="change-note">{update.note}</p>
              </div>
            </article>
          ))}
        </div>
      </main>
    );
  if (path === '/privacy/')
    return (
      <main id="main" className="article page-width">
        <header className="article-heading">
          <p className="eyebrow">YOUR INFORMATION</p>
          <h1>Website & email privacy.</h1>
          <p className="article-deck">
            What this site collects, and what happens when you join the list.
          </p>
          <p className="article-byline">Updated September 6, 2026 · Jackalope Digital LLC</p>
        </header>
        <div className="article-body">
          <section>
            <h2>The marketing website.</h2>
            <p>
              This site introduces Jackalope, a product of Jackalope Digital LLC. It does not
              request access to your repositories, agent accounts, or desktop data. Appearance
              controls affect this page and reset on reload.
            </p>
            <p>
              The site does not install analytics or advertising trackers. Its hosting provider
              receives the technical request information needed to serve the page. Fonts are served
              with the site.
            </p>
          </section>
          <section>
            <h2>If you join the waitlist.</h2>
            <p>
              The signup form sends your email address to Sequenzy, our email service, to manage
              Jackalope launch announcements and occasional product notes. The form also records
              that the signup came from jackalope.dev. Signing up is optional and does not create a
              desktop account or promise a release date.
            </p>
            <p>
              Sequenzy processes the request and subscriber record, including technical information
              used to protect forms from abuse. Emails may include delivery, open, and link tracking
              managed by the email service. Read{' '}
              <a href="https://www.sequenzy.com/privacy">Sequenzy’s privacy policy</a> for its
              handling of that information.
            </p>
          </section>
          <section>
            <h2>Your choices.</h2>
            <p>
              Use the unsubscribe link in a Jackalope email to stop receiving updates. To ask about
              your information or request its deletion, contact Jackalope Digital LLC through{' '}
              <a href="https://jackalope.digital">jackalope.digital</a>.
            </p>
          </section>
          <section>
            <h2>The app is separate.</h2>
            <p>
              This notice covers the marketing website and its email list. It does not describe
              every data flow of the desktop application or of the coding agents and services you
              choose to use.
            </p>
          </section>
        </div>
      </main>
    );
  if (path === '/blog/')
    return (
      <main id="main" className="journal-page page-width">
        <header className="journal-heading">
          <p className="eyebrow">THE JACKALOPE JOURNAL</p>
          <h1>Field notes.</h1>
          <p>
            On making room for good work.
            <br />
            Ideas, practical guides, and notes from the studio.
          </p>
        </header>
        <JournalTeaser />
      </main>
    );
  return (
    <main id="main" className="journal-page page-width">
      <header className="journal-heading">
        <p className="eyebrow">A SMALL DETOUR</p>
        <h1>Nothing here. Yet.</h1>
        <p>This page doesn’t exist. Let’s get you back to Jackalope.</p>
        <a className="button button-primary" href="/">
          Back home <ArrowRight size={16} />
        </a>
      </header>
    </main>
  );
}
