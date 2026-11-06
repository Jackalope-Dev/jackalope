import { MailIcon } from '@jackalope/ui';
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type Author, authorPath, authors, findAuthor } from './authors';
import type { BlogPost, BlogSection } from './blog-types';
import { posts, updates } from './content';
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

// Raw HTML in Markdown is dropped (skipHtml) and react-markdown strips unsafe URLs, so
// posts merged without review cannot inject markup or scripts.
const markdownComponents: Components = {
  h1: 'h3',
  h2: 'h3',
  ul: ({ node: _node, ...props }) => <ul className="blog-checklist" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="blog-checklist" {...props} />,
  pre: ({ node: _node, ...props }) => (
    <figure className="blog-code">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Overflowing code must be keyboard-scrollable. */}
      <pre tabIndex={0} {...props} />
    </figure>
  ),
  table: ({ node: _node, ...props }) => (
    <section
      className="blog-table-scroll"
      aria-label="Table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The table region must support keyboard scrolling on narrow screens.
      tabIndex={0}
    >
      <table {...props} />
    </section>
  ),
};

const BlogMarkdown = ({ children }: { children: string }) => (
  <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
    {children}
  </Markdown>
);

function JournalIndex({
  items = posts,
  heading = 'Guides and field notes',
}: {
  items?: BlogPost[];
  heading?: string;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.children) as HTMLElement[];
    let frame = 0;
    const layout = () => {
      const styles = getComputedStyle(grid);
      const columns = Number(styles.getPropertyValue('--note-columns'));
      const gap = Number.parseFloat(styles.columnGap);
      const columnWidth = (grid.clientWidth - gap * (columns - 1)) / columns;
      const spans = cards.map((card) =>
        Number(getComputedStyle(card).getPropertyValue('--note-span')),
      );
      for (const [index, card] of cards.entries()) {
        card.style.width = `${columnWidth * spans[index] + gap * (spans[index] - 1)}px`;
      }
      const heights = Array<number>(columns).fill(0);
      let previousTop = 0;
      for (const [index, card] of cards.entries()) {
        const span = spans[index];
        let column = 0;
        let top = Infinity;
        for (let start = 0; start <= columns - span; start++) {
          // Keep visual reading order aligned with the links' keyboard order.
          const candidate = Math.max(previousTop, ...heights.slice(start, start + span));
          if (candidate < top) {
            top = candidate;
            column = start;
          }
        }
        card.style.left = `${column * (columnWidth + gap)}px`;
        card.style.top = `${top}px`;
        for (let lane = column; lane < column + span; lane++) {
          heights[lane] = top + card.offsetHeight + gap;
        }
        previousTop = top;
      }
      grid.style.height = `${Math.max(...heights) - gap}px`;
      grid.dataset.masonry = '';
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    });
    observer.observe(grid);
    for (const card of cards) observer.observe(card);
    layout();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      delete grid.dataset.masonry;
      grid.style.removeProperty('height');
      for (const card of cards) card.removeAttribute('style');
    };
  }, []);

  return (
    <section className="journal-teaser page-width journal-index" aria-labelledby="notes-title">
      <div className="journal-section-heading">
        <div>
          <h2 id="notes-title">{heading}</h2>
        </div>
      </div>
      <div className="notes-grid" ref={gridRef}>
        {items.map((post) => (
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
            <Byline author={findAuthor(post.author)} /> <span>·</span>{' '}
            <time dateTime={post.date}>{dateLabel(post.date)}</time>
            {post.updated && (
              <>
                <span>·</span> Updated{' '}
                <time dateTime={post.updated}>{dateLabel(post.updated)}</time>
              </>
            )}
            <span>·</span>
            {post.readingTime}
          </div>
        </header>
        <div className="article-body blog-body">
          {post.sections.length >= 3 && (
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
          {post.intro && <BlogMarkdown>{post.intro}</BlogMarkdown>}
          {post.sections.map((section, index) => (
            <section key={section.title} aria-labelledby={sectionId(section, index)}>
              <h2 id={sectionId(section, index)} tabIndex={-1}>
                {section.title}
              </h2>
              {section.markdown && <BlogMarkdown>{section.markdown}</BlogMarkdown>}
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
            <a href="/tour/">Watch the app tour</a> or <a href="/#how-it-works">see how it works</a>
            .
          </p>
          {(post.related || post.category === 'Practical guides') && (
            <p>
              <a href="/#newsletter">Sign up free</a> to try Jackalope on your own projects.
            </p>
          )}
        </div>
      </main>
    );
  const author = authors.find((item) => path === authorPath(item));
  if (author) return <AuthorPage author={author} />;
  if (path === '/changelog/')
    return (
      <main id="main" className="journal-page page-width">
        <header className="journal-heading">
          <h1>Changelog</h1>
          <p>New features, meaningful improvements, and major milestones.</p>
        </header>
        {publishedVersion && <PublishedReleases />}
        <div className="release-status">
          <MailIcon size={20} aria-hidden="true" />
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
                <span className="change-status" data-state={update.state}>
                  {update.status}
                  {update.version && <small>v{update.version}</small>}
                </span>
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
          <h1>Field notes.</h1>
          <p>
            Inside the work. Behind the decisions. Practical guides and a closer look at what we’re
            building.
          </p>
        </header>
        <JournalIndex />
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

function Byline({ author }: { author?: Author }) {
  if (!author) return <>Jackalope Digital LLC</>;
  return (
    <a className="article-author" href={authorPath(author)} rel="author">
      <img src={author.image} alt="" width={20} height={20} />
      {author.name}
    </a>
  );
}

function AuthorPage({ author }: { author: Author }) {
  const written = posts.filter((post) => post.author === author.slug);
  return (
    <main id="main" className="journal-page page-width">
      <nav className="article-breadcrumbs" aria-label="Breadcrumb">
        <a href="/">Jackalope</a>
        <span aria-hidden="true">/</span>
        <a href="/blog/">Field notes</a>
      </nav>
      <header className="author-profile">
        <img src={author.image} alt={author.name} width={128} height={128} />
        <div>
          <h1 className="author-name">{author.name}</h1>
          <p className="author-role">{author.jobTitle}</p>
          <p>{author.bio}</p>
          <ul className="author-links" aria-label={`${author.name} elsewhere`}>
            {author.profiles.map((profile) => (
              <li key={profile.url}>
                <a href={profile.url} rel="me noopener" target="_blank">
                  {profile.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </header>
      {written.length > 0 && (
        <JournalIndex items={written} heading={`Articles by ${author.name}`} />
      )}
    </main>
  );
}
