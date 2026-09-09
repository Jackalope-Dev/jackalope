import { guideMarkdown } from '@jackalope/knowledge';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  Info,
  Lightbulb,
  Search,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { siteOrigin } from './content';
import {
  type GuideCategory,
  guideCategories,
  type KnowledgeGuide,
  type KnowledgeGuideSection,
  knowledgeGuides,
  likelyArticleSlugs,
  troubleshootingScenarios,
} from './knowledge-content';

function normalizeKnowledgePath(path: string) {
  const trimmed = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '/knowledge/';
}

export function KnowledgebasePage({
  path = '/knowledge/',
  dark: _dark = false,
}: {
  path?: string;
  dark?: boolean;
}) {
  const normalizedPath = normalizeKnowledgePath(path);
  const slug = normalizedPath.replace(/^\/knowledge\//, '').replace(/\/$/, '');
  const activeGuide = useMemo(
    () => (slug ? (knowledgeGuides.find((g) => g.slug === slug) ?? null) : null),
    [slug],
  );

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GuideCategory | 'all'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');

  const copyToClipboard = async (id: string, text: string) => {
    try {
      setCopyError('');
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      setCopyError('Copy failed. Open the Markdown version and copy its text.');
    }
  };

  // Scroll spy for active table of contents heading on dedicated guide pages
  useEffect(() => {
    if (!activeGuide) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHeadingId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );

    for (const section of activeGuide.sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [activeGuide]);

  // Search results across all guides and sections
  const searchResults = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const results: {
      guide: KnowledgeGuide;
      section: KnowledgeGuideSection;
    }[] = [];

    for (const guide of knowledgeGuides) {
      for (const section of guide.sections) {
        const questionMatch = section.question.toLowerCase().includes(trimmed);
        const paragraphMatch = section.paragraphs.some((p) => p.toLowerCase().includes(trimmed));
        const bulletMatch = section.bullets?.some((b) => b.toLowerCase().includes(trimmed));
        const codeMatch = section.codeBox?.code.toLowerCase().includes(trimmed);

        if (questionMatch || paragraphMatch || bulletMatch || codeMatch) {
          results.push({ guide, section });
        }
      }
    }
    return results;
  }, [query]);

  // Filtered guides for the hub view
  const filteredGuides = useMemo(() => {
    if (selectedCategory === 'all') return knowledgeGuides;
    return knowledgeGuides.filter((g) => g.category === selectedCategory);
  }, [selectedCategory]);

  // Likely articles
  const likelyArticles = useMemo(() => {
    return likelyArticleSlugs
      .map((slug) => knowledgeGuides.find((g) => g.slug === slug))
      .filter((g): g is KnowledgeGuide => Boolean(g));
  }, []);

  // ---------------------------------------------------------------------------
  // View 1: Dedicated Guide Page
  // ---------------------------------------------------------------------------
  if (activeGuide) {
    const guideIndex = knowledgeGuides.findIndex((g) => g.slug === activeGuide.slug);
    const prevGuide = guideIndex > 0 ? knowledgeGuides[guideIndex - 1] : null;
    const nextGuide =
      guideIndex < knowledgeGuides.length - 1 ? knowledgeGuides[guideIndex + 1] : null;

    return (
      <main id="main" className="knowledge-guide-page page-width">
        {/* Breadcrumb Navigation */}
        <nav className="article-breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Jackalope</a>
          <span aria-hidden="true">/</span>
          <a href="/knowledge/">Knowledgebase</a>
          <span aria-hidden="true">/</span>
          <span>{activeGuide.shortTitle}</span>
        </nav>

        {/* Guide Article Header */}
        <header className="knowledge-guide-header">
          <h1>{activeGuide.title}</h1>
          <p className="knowledge-guide-lede">{activeGuide.description}</p>
          <div className="knowledge-agent-actions">
            <button
              type="button"
              onClick={() => void copyToClipboard('guide', guideMarkdown(activeGuide, siteOrigin))}
            >
              {copiedId === 'guide' ? <Check size={16} /> : <Copy size={16} />}{' '}
              {copiedId === 'guide' ? 'Copied' : 'Copy for your agent'}
            </button>
            <a href={`/knowledge/${activeGuide.slug}/index.md`}>Read Markdown</a>
          </div>
          {copyError && <p role="alert">{copyError}</p>}
          <div className="knowledge-guide-meta">
            <span>{activeGuide.readingTime}</span>
            <span aria-hidden="true">·</span>
            <span>{activeGuide.sections.length} core topics covered</span>
            <span aria-hidden="true">·</span>
            <span>Jackalope Architecture</span>
          </div>
        </header>

        {/* Two-Column Layout: Sticky Sidebar TOC + Long-Form Article Body */}
        <div className="knowledge-guide-layout">
          {/* Sticky Table of Contents Sidebar */}
          <aside className="knowledge-guide-sidebar" aria-label="Table of contents">
            <div className="knowledge-toc-sticky">
              <a href="/knowledge/" className="knowledge-back-link">
                <ArrowLeft size={14} /> Back to all guides
              </a>
              <div className="knowledge-toc-heading">On this page</div>
              <nav className="knowledge-toc-nav">
                {activeGuide.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className={`knowledge-toc-link ${
                      activeHeadingId === section.id ? 'active' : ''
                    }`}
                  >
                    {section.question}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Guide Article Body */}
          <div className="knowledge-guide-content">
            {activeGuide.sections.map((section) => (
              <section key={section.id} id={section.id} className="knowledge-guide-section">
                <h2>{section.question}</h2>

                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}

                {section.bullets && section.bullets.length > 0 && (
                  <ul className="knowledge-bullet-list">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>
                        <Check size={16} className="knowledge-bullet-icon" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {section.callout && (
                  <div className={`knowledge-callout knowledge-callout-${section.callout.kind}`}>
                    <div className="knowledge-callout-icon" aria-hidden="true">
                      {section.callout.kind === 'important' ? (
                        <AlertCircle size={18} />
                      ) : section.callout.kind === 'tip' ? (
                        <Lightbulb size={18} />
                      ) : (
                        <Info size={18} />
                      )}
                    </div>
                    <div className="knowledge-callout-body">
                      <strong>
                        {section.callout.kind === 'important'
                          ? 'Important'
                          : section.callout.kind === 'tip'
                            ? 'Tip'
                            : 'Note'}
                      </strong>
                      <p>{section.callout.text}</p>
                    </div>
                  </div>
                )}

                {section.codeBox && (
                  <div className="knowledge-code-box">
                    <div className="knowledge-code-header">
                      <span>{section.codeBox.title}</span>
                      <button
                        type="button"
                        className="knowledge-copy-btn"
                        onClick={() =>
                          copyToClipboard(`${section.id}-code`, section.codeBox?.code || '')
                        }
                        aria-label={`Copy ${section.codeBox.title}`}
                      >
                        {copiedId === `${section.id}-code` ? (
                          <>
                            <CheckCheck size={13} /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={13} /> Copy
                          </>
                        )}
                      </button>
                    </div>
                    <pre>
                      <code>{section.codeBox.code}</code>
                    </pre>
                  </div>
                )}
              </section>
            ))}

            {/* Pagination Navigation Between Guides */}
            <nav className="knowledge-guide-pagination" aria-label="Guides pagination">
              {prevGuide ? (
                <a href={`/knowledge/${prevGuide.slug}/`} className="knowledge-page-nav-link prev">
                  <span className="knowledge-page-nav-label">Previous Guide</span>
                  <span className="knowledge-page-nav-title">
                    <ArrowLeft size={14} /> {prevGuide.shortTitle}
                  </span>
                </a>
              ) : (
                <div />
              )}
              {nextGuide && (
                <a href={`/knowledge/${nextGuide.slug}/`} className="knowledge-page-nav-link next">
                  <span className="knowledge-page-nav-label">Next Guide</span>
                  <span className="knowledge-page-nav-title">
                    {nextGuide.shortTitle} <ArrowRight size={14} />
                  </span>
                </a>
              )}
            </nav>
          </div>
        </div>

        {/* Clean Support Diagnostics Callout */}
        <section className="knowledge-footer-cta" aria-labelledby="knowledge-help-title">
          <div className="knowledge-footer-card">
            <div>
              <h3 id="knowledge-help-title">Need help with something not covered here?</h3>
              <p>
                Export an anonymized diagnostics report under Settings → Updates &amp; support, or
                share private feedback directly with the Jackalope maintainers.
              </p>
            </div>
            <div className="knowledge-footer-actions">
              <a className="button button-primary button-compact" href="/feedback/">
                Send feedback <ArrowRight size={14} />
              </a>
              <a className="button button-quiet button-compact" href="/knowledge/">
                Browse all guides
              </a>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // View 2: Knowledgebase Hub Overview (/knowledge/)
  // ---------------------------------------------------------------------------
  return (
    <main id="main" className="knowledge-hub-page">
      {/* Clean Hero Header */}
      <header className="knowledge-hero">
        <div className="page-width">
          <nav className="article-breadcrumbs" aria-label="Breadcrumb">
            <a href="/">Jackalope</a>
            <span aria-hidden="true">/</span>
            <span>Knowledgebase</span>
          </nav>

          <div className="knowledge-hero-content">
            <h1>Guides, Architecture &amp; Troubleshooting</h1>
            <p className="knowledge-lede">
              In-depth architecture documentation, quick troubleshooting playbooks, and how-tos for
              building thoughtfully with coding agents in Jackalope.
            </p>

            {/* Streamlined Search Bar */}
            <div className="knowledge-agent-actions">
              <a href="/knowledge/ask-jackalope/">Ask Jackalope & local agent tools</a>
              <a href="/knowledge/llms.txt">Documentation for your agent</a>
            </div>
            <search className="knowledge-search-bar">
              <Search size={18} className="knowledge-search-icon" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documentation, topics, or errors…"
                className="knowledge-search-input"
                aria-label="Search knowledgebase"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="knowledge-search-clear"
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </search>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="page-width">
        {query.trim() ? (
          /* Live Search Results View */
          <section className="knowledge-search-results" aria-label="Search results">
            <div className="knowledge-results-header">
              <h2>Results for &ldquo;{query}&rdquo;</h2>
              <span className="knowledge-results-count">
                Found {searchResults.length} matching{' '}
                {searchResults.length === 1 ? 'topic' : 'topics'}
              </span>
            </div>

            {searchResults.length === 0 ? (
              <div className="knowledge-empty">
                <h3>No matching guides or answers found</h3>
                <p>
                  Try searching for a different keyword or error phrase, or browse the complete
                  guides below.
                </p>
                <button
                  type="button"
                  className="button button-primary button-compact"
                  onClick={() => setQuery('')}
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className="knowledge-search-list">
                {searchResults.map(({ guide, section }) => (
                  <a
                    key={`${guide.slug}-${section.id}`}
                    href={`/knowledge/${guide.slug}/#${section.id}`}
                    className="knowledge-search-item"
                  >
                    <div className="knowledge-search-item-guide">{guide.title}</div>
                    <h3>{section.question}</h3>
                    <p>{section.paragraphs[0]}</p>
                    <span className="knowledge-search-item-link">
                      Read in guide <ArrowRight size={14} />
                    </span>
                  </a>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* 1. Quick Troubleshooting Diagnostic Helper */}
            <section className="knowledge-diagnostic-helper" aria-label="Troubleshooting assistant">
              <div className="knowledge-helper-header">
                <div className="knowledge-helper-badge">
                  <Wrench size={16} /> Quick Diagnostic Assistant
                </div>
                <h2>What problem are you trying to solve?</h2>
                <p>
                  Instant diagnosis and resolution recipes for the most common local developer
                  environment and agent execution scenarios.
                </p>
              </div>

              <div className="knowledge-scenario-grid">
                {troubleshootingScenarios.map((scenario) => {
                  const targetHref = `/knowledge/${scenario.targetSlug}/${
                    scenario.targetAnchor ? `#${scenario.targetAnchor}` : ''
                  }`;

                  return (
                    <a key={scenario.id} href={targetHref} className="knowledge-scenario-card">
                      <h3>{scenario.title}</h3>
                      <p className="knowledge-scenario-symptom">{scenario.symptom}</p>
                      <p className="knowledge-scenario-quickfix">{scenario.quickFix}</p>
                      <span className="knowledge-scenario-action">
                        View resolution steps <ArrowRight size={14} />
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>

            {/* 2. Likely Articles You May Be Looking For */}
            <section className="knowledge-likely-section" aria-label="Frequently visited guides">
              <div className="knowledge-section-intro">
                <h2>Frequently Visited Guides</h2>
                <p>Essential architecture references, configuration steps, and safety contracts.</p>
              </div>

              <div className="knowledge-likely-grid">
                {likelyArticles.map((guide) => (
                  <a
                    key={guide.slug}
                    href={`/knowledge/${guide.slug}/`}
                    className="knowledge-likely-card"
                  >
                    <span className="knowledge-likely-reading-time">{guide.readingTime}</span>
                    <h3>{guide.title}</h3>
                    <p>{guide.description}</p>
                    <span className="knowledge-likely-link">
                      Read guide <ArrowRight size={14} />
                    </span>
                  </a>
                ))}
              </div>
            </section>

            {/* 3. Category Filter Buttons & Guides Grid */}
            <section className="knowledge-hub-guides" aria-label="Documentation guides by category">
              <div className="knowledge-section-intro">
                <h2>Browse by Topic</h2>
                <p>
                  Explore all {knowledgeGuides.length} official technical guides and architectural
                  specifications.
                </p>
              </div>

              {/* Clean Category Filter Buttons */}
              <nav className="knowledge-category-bar" aria-label="Filter by topic">
                <button
                  type="button"
                  className={`knowledge-category-btn ${selectedCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedCategory('all')}
                >
                  All Topics ({knowledgeGuides.length})
                </button>
                {guideCategories.map((cat) => {
                  const count = knowledgeGuides.filter((g) => g.category === cat.id).length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={`knowledge-category-btn ${
                        selectedCategory === cat.id ? 'active' : ''
                      }`}
                      onClick={() => setSelectedCategory(cat.id)}
                    >
                      {cat.label} ({count})
                    </button>
                  );
                })}
              </nav>

              {/* Guide Cards Grid */}
              <div className="knowledge-hub-grid">
                {filteredGuides.map((guide) => (
                  <article key={guide.slug} className="knowledge-hub-card">
                    <div className="knowledge-card-reading-time">{guide.readingTime}</div>
                    <h3>
                      <a href={`/knowledge/${guide.slug}/`}>{guide.title}</a>
                    </h3>
                    <p>{guide.description}</p>

                    <div className="knowledge-card-topics">
                      <span className="knowledge-card-topics-label">Key topics covered:</span>
                      <ul>
                        {guide.sections.slice(0, 3).map((section) => (
                          <li key={section.id}>
                            <a href={`/knowledge/${guide.slug}/#${section.id}`}>
                              {section.question}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <a href={`/knowledge/${guide.slug}/`} className="knowledge-card-footer-link">
                      Read guide <ArrowRight size={14} />
                    </a>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {/* Clean Support Diagnostics Callout */}
        <section className="knowledge-footer-cta" aria-labelledby="knowledge-help-title-hub">
          <div className="knowledge-footer-card">
            <div>
              <h3 id="knowledge-help-title-hub">Need help with something not covered here?</h3>
              <p>
                Export an anonymized diagnostics report under Settings → Updates &amp; support, or
                share private feedback directly with the Jackalope maintainers.
              </p>
            </div>
            <div className="knowledge-footer-actions">
              <a className="button button-primary button-compact" href="/feedback/">
                Send feedback <ArrowRight size={14} />
              </a>
              <a className="button button-quiet button-compact" href="/tour/">
                Watch app tour
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
