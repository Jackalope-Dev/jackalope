import { ArrowRight, Mail } from 'lucide-react';
import type { BlogSection } from './blog-types';
import { posts, tour, updates } from './content';
import { EditorialArt } from './EditorialArt';
import { PublishedReleases } from './PublishedReleases';
import './blog.css';

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

const sectionId = (section: BlogSection, index: number) => section.id || `section-${index + 1}`;

export function JournalTeaser({ all = false }: { all?: boolean }) {
  return (
    <section
      className={`journal-teaser page-width${all ? ' journal-index' : ''}`}
      aria-labelledby="notes-title"
    >
      <div className="journal-section-heading">
        <div>
          <h2 id="notes-title">{all ? 'Guides and field notes' : 'A few field notes.'}</h2>
        </div>
        {!all && (
          <a className="text-link" href="/blog/">
            All notes <ArrowRight size={16} />
          </a>
        )}
      </div>
      <div className="notes-grid">
        {(all ? posts : posts.slice(0, 2)).map((post) => (
          <a
            className="note-preview"
            href={`/blog/${post.slug}/`}
            key={post.slug}
            aria-labelledby={`note-${post.slug}`}
          >
            <EditorialArt
              {...(post.cover ?? { kind: 'studio', tone: 'indigo', label: 'From the studio' })}
            />
            <div className="note-copy">
              <div className="note-meta">
                {post.category}
                <span>{post.readingTime}</span>
              </div>
              <h3 id={`note-${post.slug}`}>{post.title}</h3>
              <p>{post.description}</p>
              <div className="note-footer">
                <time dateTime={post.date}>{dateLabel(post.date)}</time>
                <ArrowRight size={18} aria-hidden="true" />
              </div>
            </div>
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
        <div className="article-body blog-body">
          {post.related && (
            <nav className="blog-contents" aria-label="On this page">
              <h2>On this page</h2>
              <ol>
                {post.sections.map((section, index) => (
                  <li key={section.title}>
                    <a href={`#${sectionId(section, index)}`}>{section.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {post.sections.map((section, index) => (
            <section key={section.title} aria-labelledby={sectionId(section, index)}>
              <h2 id={sectionId(section, index)} tabIndex={-1}>
                {section.title}
              </h2>
              {section.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
              {section.bullets && (
                <ul className="blog-checklist">
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.code && (
                <figure className="blog-code">
                  <figcaption>{section.code.label}</figcaption>
                  {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Overflowing code must be keyboard-scrollable. */}
                  <pre tabIndex={0}>
                    <code>{section.code.value}</code>
                  </pre>
                </figure>
              )}
              {section.table && (
                <section
                  className="blog-table-scroll"
                  aria-label={section.table.caption}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: The table region must support keyboard scrolling on narrow screens.
                  tabIndex={0}
                >
                  <table>
                    <caption>{section.table.caption}</caption>
                    <thead>
                      <tr>
                        {section.table.headers.map((header) => (
                          <th key={header} scope="col">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, cellIndex) =>
                            cellIndex === 0 ? (
                              <th key={cell} scope="row">
                                {cell}
                              </th>
                            ) : (
                              <td key={cell}>{cell}</td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              {section.links && (
                <ul className="blog-references" aria-label={`References for ${section.title}`}>
                  {section.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href}>{link.label}</a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {post.related && (
            <nav className="blog-related" aria-label="Further reading">
              <h2>Keep reading</h2>
              <ul>
                {post.related.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>
                      {link.label} <ArrowRight size={16} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <a className="text-link" href="/changelog/">
            Follow what’s taking shape <ArrowRight size={16} />
          </a>
          <p>
            <a href="/tour/">Watch the app tour</a> or{' '}
            <a href="/#workflow">explore the task workspace</a>.
          </p>
          {post.related && (
            <p>
              <a href="/#newsletter">Join the early-access waitlist</a> to try Jackalope when access
              is ready.
            </p>
          )}
        </div>
      </main>
    );
  if (path === '/changelog/')
    return (
      <main id="main" className="journal-page page-width">
        <header className="journal-heading">
          <h1>Changelog</h1>
          <p>New features, meaningful improvements, and major milestones.</p>
        </header>
        {publishedVersion && <PublishedReleases />}
        <div className="release-status">
          <Mail size={18} aria-hidden="true" />
          <p>
            <strong>Get the next update.</strong> Join our newsletter for launch news and occasional
            product notes. <a href="#newsletter">Sign up for updates</a>.
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
                {update.note && <p className="change-note">{update.note}</p>}
              </div>
            </article>
          ))}
        </div>
      </main>
    );
  if (path === '/blog/')
    return (
      <main id="main" className="journal-page field-notes-page page-width">
        <header className="journal-heading">
          <p className="eyebrow">The Jackalope journal</p>
          <h1>Field notes.</h1>
          <p>
            Inside the work. Behind the decisions. Practical guides and a closer look at what we’re
            building.
          </p>
        </header>
        <JournalTeaser all />
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
