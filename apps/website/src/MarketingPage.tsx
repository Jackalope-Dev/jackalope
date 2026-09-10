import { ArrowRight, Check, Play } from 'lucide-react';
import type { MarketingPage as MarketingPageContent } from './marketing-content';
import { WaitlistButton } from './Signup';
import './comparisons.css';

export function MarketingPage({ page, dark }: { page: MarketingPageContent; dark: boolean }) {
  const comparison = page.comparison;
  const isComparison = page.path.startsWith('/compare/');
  return (
    <main id="main" className={`acquisition-page${isComparison ? ' comparison-page' : ''}`}>
      <header className="acquisition-hero">
        <div className="page-width acquisition-hero-grid">
          <div className="acquisition-copy">
            <nav className="article-breadcrumbs" aria-label="Breadcrumb">
              <a href="/">Jackalope</a>
              <span aria-hidden="true">/</span>
              {page.path !== '/compare/' && isComparison && (
                <>
                  <a href="/compare/">Compare</a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              <span>{page.kind}</span>
            </nav>
            <h1>{page.headline}</h1>
            <p className="acquisition-lede">{page.lede}</p>
            {comparison && (
              <p className="comparison-byline">
                By Jackalope · Sources reviewed{' '}
                <time dateTime={comparison.reviewed}>
                  {new Date(`${comparison.reviewed}T12:00:00Z`).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </time>
              </p>
            )}
            <div className="acquisition-actions">
              <WaitlistButton />
              <a className="acquisition-text-link" href="/tour/">
                <Play size={14} fill="currentColor" /> Watch the app
              </a>
            </div>
          </div>
          <div className="acquisition-proof">
            <div className="acquisition-proof-label">
              <span>Jackalope workspace</span>
              <span>Atlas sample project</span>
            </div>
            <img
              src={`/media/${page.image}${dark ? '' : '-light'}.png`}
              width="1440"
              height="840"
              alt={`Jackalope ${page.image} interface with fictional Atlas project data`}
            />
          </div>
        </div>
        <section className="page-width acquisition-signals" aria-label="Key capabilities">
          {page.signals.map((signal, index) => (
            <span key={signal}>
              <small>0{index + 1}</small>
              {signal}
            </span>
          ))}
        </section>
      </header>

      <div className="page-width acquisition-body">
        <article>
          {comparison && (
            <section id="at-a-glance" className="comparison-overview">
              <div>
                <h2>The workflow at a glance</h2>
                <p>
                  An editorial comparison by Jackalope, based on the official sources linked below.
                  These are documented capabilities, not hands-on performance rankings.
                </p>
                <section
                  className="comparison-table-scroll"
                  aria-label={`Jackalope and ${comparison.name} workflow comparison`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Wide tables need keyboard scrolling.
                  tabIndex={0}
                >
                  <table>
                    <caption>Jackalope and {comparison.name}: key workflow differences</caption>
                    <thead>
                      <tr>
                        <th scope="col">Workflow</th>
                        <th scope="col">Jackalope</th>
                        <th scope="col">{comparison.name}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map((row) => (
                        <tr key={row.topic}>
                          <th scope="row">{row.topic}</th>
                          <td>{row.jackalope}</td>
                          <td>{row.competitor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <p className="comparison-sources">
                  Sources:{' '}
                  {comparison.sources.map((source, index) => (
                    <span key={source.href}>
                      {index > 0 && ' · '}
                      <a href={source.href}>{source.label}</a>
                    </span>
                  ))}
                  . Jackalope is coming soon; <a href="/agents/">check agent compatibility</a> and
                  the <a href="/roadmap/">roadmap</a>.
                </p>
              </div>
            </section>
          )}
          {page.sections.map((section, index) => (
            <section key={section.title} id={`section-${index + 1}`}>
              <div className="acquisition-section-index">0{index + 1}</div>
              <div>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.table && (
                  <section
                    className="comparison-table-scroll"
                    aria-label={section.title}
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: Wide tables need keyboard scrolling.
                    tabIndex={0}
                  >
                    <table>
                      <caption>{section.title}</caption>
                      <thead>
                        <tr>
                          {section.table.columns.map((column) => (
                            <th scope="col" key={column}>
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map(([heading, ...cells]) => (
                          <tr key={heading}>
                            <th scope="row">{heading}</th>
                            {cells.map((cell) => (
                              <td key={cell}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
                {section.bullets && (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>
                        <Check size={15} />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {section.links && (
                  <p className="comparison-sources">
                    {section.links.map((link, linkIndex) => (
                      <span key={link.href}>
                        {linkIndex > 0 && ' · '}
                        <a href={link.href}>{link.label}</a>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </section>
          ))}
          {comparison && (
            <>
              <section id="questions" className="comparison-overview">
                <div>
                  <h2>Common questions</h2>
                  {comparison.faqs.map((faq) => (
                    <div className="comparison-faq" key={faq.question}>
                      <h3>{faq.question}</h3>
                      <p>{faq.answer}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="comparison-overview">
                <div>
                  <h2>See how Jackalope fits your work</h2>
                  <p>
                    Explore <a href="/agents/">supported agents</a>, learn about{' '}
                    <a href="/git-worktrees-for-ai-agents/">Git worktrees</a>, or read the{' '}
                    <a href="/guides/review-ai-generated-code/">code review guide</a>. Join the
                    waitlist to hear when early access is ready.
                  </p>
                  <div className="acquisition-actions">
                    <WaitlistButton />
                    <a className="acquisition-text-link" href="/tour/">
                      Watch the app tour <ArrowRight size={15} />
                    </a>
                  </div>
                </div>
              </section>
            </>
          )}
        </article>
        <aside className="acquisition-related" aria-labelledby="related-title">
          <p id="related-title">{isComparison ? 'Compare workspaces' : 'Keep exploring'}</p>
          {page.related.map((link) => (
            <a href={link.href} key={link.href}>
              {link.label} <ArrowRight size={15} />
            </a>
          ))}
          <a href="/roadmap/">
            Roadmap <ArrowRight size={15} />
          </a>
        </aside>
      </div>
    </main>
  );
}
