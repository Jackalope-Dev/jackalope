import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { ArrowRight, Check, Play } from 'lucide-react';
import {
  ComparisonDirectory,
  ComparisonGuide,
  ComparisonVisual,
  ComparisonWorkflows,
} from './ComparisonVisual';
import { FeatureMedia } from './FeatureMedia';
import { featureMedia } from './feature-media';
import type { MarketingPage as MarketingPageContent } from './marketing-content';
import { WaitlistButton } from './Signup';
import './comparisons.css';

export function MarketingPage({ page, dark }: { page: MarketingPageContent; dark: boolean }) {
  const comparison = page.comparison;
  const isComparison = page.path.startsWith('/compare/');
  const isDirectory = page.path === '/compare/';
  const hasFeatureMedia = Boolean(featureMedia[page.path]);
  return (
    <main
      id="main"
      className={`acquisition-page${isComparison ? ' comparison-page' : ''}${hasFeatureMedia ? ' feature-page' : ''}`}
    >
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
              <a
                className="acquisition-text-link"
                href={hasFeatureMedia ? '#feature-preview' : '/tour/'}
              >
                <Play size={14} fill="currentColor" />{' '}
                {hasFeatureMedia ? 'See it in Jackalope' : 'Watch the app'}
              </a>
            </div>
          </div>
          {comparison ? (
            <ComparisonVisual comparison={comparison} />
          ) : isDirectory ? (
            <ComparisonGuide />
          ) : hasFeatureMedia ? (
            <FeatureMedia key={page.path} path={page.path} dark={dark} />
          ) : (
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
          )}
        </div>
        {!isComparison && (
          <section className="page-width acquisition-signals" aria-label="Key capabilities">
            {page.signals.map((signal, index) => (
              <span key={signal}>
                <small>0{index + 1}</small>
                {signal}
              </span>
            ))}
          </section>
        )}
      </header>

      <div className="page-width acquisition-body">
        <article>
          {isDirectory && <ComparisonDirectory />}
          {comparison && (
            <section id="at-a-glance" className="comparison-overview">
              <div>
                <span className="comparison-eyebrow">Side by side</span>
                <h2>What changes in your workflow?</h2>
                <p>
                  A comparison by Jackalope, based on the linked official sources. Shared features
                  can work differently; this is a workflow guide, not a performance ranking.
                </p>
                <ComparisonWorkflows comparison={comparison} />
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
          {isComparison ? (
            <section className="comparison-overview comparison-deep-dive" id="details">
              <div>
                <span className="comparison-eyebrow">A closer look</span>
                <h2>{isDirectory ? 'How to choose' : 'Go deeper where it matters.'}</h2>
                {page.sections.map((section, index) => (
                  <Disclosure
                    className="comparison-detail"
                    key={section.title}
                    id={`section-${index + 1}`}
                  >
                    <DisclosureSummary>
                      <h3>{section.title}</h3>
                    </DisclosureSummary>
                    <div>
                      <SectionContent section={section} />
                    </div>
                  </Disclosure>
                ))}
              </div>
            </section>
          ) : (
            page.sections.map((section, index) => (
              <section key={section.title} id={`section-${index + 1}`}>
                <div className="acquisition-section-index">0{index + 1}</div>
                <div>
                  <h2>{section.title}</h2>
                  <SectionContent section={section} />
                </div>
              </section>
            ))
          )}
          {comparison && (
            <>
              {comparison.faqs.length > 0 && (
                <section id="questions" className="comparison-overview">
                  <div>
                    <h2>Common questions</h2>
                    {comparison.faqs.map((faq) => (
                      <Disclosure className="comparison-detail" key={faq.question}>
                        <DisclosureSummary>
                          <h3>{faq.question}</h3>
                        </DisclosureSummary>
                        <p>{faq.answer}</p>
                      </Disclosure>
                    ))}
                  </div>
                </section>
              )}
              <section className="comparison-overview comparison-next">
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
          <h2 id="related-title">{isComparison ? 'Compare workspaces' : 'Keep exploring'}</h2>
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

function SectionContent({ section }: { section: MarketingPageContent['sections'][number] }) {
  return (
    <>
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
    </>
  );
}
