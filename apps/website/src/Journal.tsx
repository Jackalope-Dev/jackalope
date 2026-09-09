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

export function JournalPage({ path }: { path: string }) {
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
            Make it yours, put your agents to work, and explore how your code fits together.
          </p>
          <p className="article-byline">
            {tour.durationSeconds} seconds · Product walkthrough · Sample data · Music
          </p>
        </header>
        <video
          className="tour-player"
          controls
          playsInline
          preload="metadata"
          poster={tour.poster}
          aria-label="Jackalope desktop app tour"
        >
          <source src={tour.video} type="video/mp4" />
          <track kind="captions" src={tour.captions} srcLang="en" label="English descriptions" />
          <a href={tour.video}>Watch the launch film</a>
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
                'Coming soon.'
              )}{' '}
              <a href="/#newsletter">Join the waitlist</a> for launch news, or{' '}
              <a href="/changelog/">follow the development changelog</a>.
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
          <h1>Changelog</h1>
          <p>Development updates and published releases.</p>
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
                <strong>Coming soon.</strong> These are development milestones, not downloadable
                releases.
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
  if (path === '/blog/')
    return (
      <main id="main" className="journal-page page-width">
        <header className="journal-heading">
          <h1>Field notes.</h1>
          <p>Ideas, practical guides, and product updates.</p>
        </header>
        <JournalTeaser />
      </main>
    );
  return (
    <main id="main" className="journal-page page-width">
      <header className="journal-heading">
        <h1>Page not found</h1>
        <p>This page doesn’t exist. Let’s get you back to Jackalope.</p>
        <a className="button button-primary" href="/">
          Back home <ArrowRight size={16} />
        </a>
      </header>
    </main>
  );
}
