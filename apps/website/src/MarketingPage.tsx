import { ArrowRight, Check, Play } from 'lucide-react';
import type { MarketingPage as MarketingPageContent } from './marketing-content';

export function MarketingPage({ page, dark }: { page: MarketingPageContent; dark: boolean }) {
  return (
    <main id="main" className="acquisition-page">
      <header className="acquisition-hero">
        <div className="page-width acquisition-hero-grid">
          <div className="acquisition-copy">
            <nav className="article-breadcrumbs" aria-label="Breadcrumb">
              <a href="/">Jackalope</a>
              <span aria-hidden="true">/</span>
              <span>{page.kind}</span>
            </nav>
            <p className="acquisition-kind">{page.kind}</p>
            <h1>{page.headline}</h1>
            <p className="acquisition-lede">{page.lede}</p>
            <div className="acquisition-actions">
              <a className="button button-primary" href="/#newsletter">
                Join the waitlist <ArrowRight size={16} />
              </a>
              <a className="acquisition-text-link" href="/tour/">
                <Play size={14} fill="currentColor" /> Watch the app
              </a>
            </div>
          </div>
          <div className="acquisition-proof">
            <div className="acquisition-proof-label">
              <span>JACKALOPE / ACTUAL APP</span>
              <span>DEVELOPMENT PREVIEW</span>
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
          {page.sections.map((section, index) => (
            <section key={section.title}>
              <div className="acquisition-section-index">0{index + 1}</div>
              <div>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
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
              </div>
            </section>
          ))}
        </article>
        <aside className="acquisition-related" aria-labelledby="related-title">
          <p id="related-title">Keep exploring</p>
          {page.related.map((link) => (
            <a href={link.href} key={link.href}>
              {link.label} <ArrowRight size={15} />
            </a>
          ))}
          <span>
            Jackalope is in prerelease. Our first launch is planned for macOS, Windows, and Linux.
            Join the waitlist for availability.
          </span>
        </aside>
      </div>
    </main>
  );
}
