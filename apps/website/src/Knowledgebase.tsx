import { guideMarkdown } from '@jackalope/knowledge';
import { ArrowLeft, ArrowRight, Check, Copy, Info, Play, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { siteOrigin } from './content';
import { KnowledgeMedia } from './KnowledgeMedia';
import {
  type GuideCategory,
  guideCategories,
  type KnowledgeGuideSection,
  knowledgeGuides,
  troubleshootingScenarios,
} from './knowledge-content';
import { knowledgeClips } from './knowledge-media';

const guideHref = (slug: string) => `/knowledge/${slug}/`;
const categoryLabel = (category: GuideCategory) =>
  guideCategories.find((item) => item.id === category)?.label;
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const matchesTerms = (text: string, terms: string[]) => {
  const tokens = words(text);
  return terms.every((term) => tokens.some((token) => token.startsWith(term)));
};
const sectionText = (section: KnowledgeGuideSection) =>
  [
    section.question,
    ...section.paragraphs,
    ...(section.bullets ?? []),
    ...(section.steps ?? []),
    section.codeBox?.code,
    section.callout?.text,
    ...(section.links?.map((link) => link.label) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
const startingPoints = [
  {
    slug: 'multi-account-and-agents',
    title: 'Connect an agent',
    description: 'Install a CLI, choose an account, and check access.',
  },
  {
    slug: 'task-composer-and-effort-levels',
    title: 'Run your first task',
    description: 'Write a useful brief and review the result.',
  },
  {
    slug: 'git-worktrees',
    title: 'Work in parallel',
    description: 'Separate changes and bring them back together.',
  },
];

function SupportLinks() {
  return (
    <section className="knowledge-footer-card" aria-labelledby="knowledge-help-title">
      <div>
        <h2 id="knowledge-help-title">Still need a hand?</h2>
        <p>
          Ask the in-app helper for a guide, or preview a support report in Settings → Updates &amp;
          support before sharing feedback.
        </p>
      </div>
      <div className="knowledge-footer-actions">
        <a className="button button-primary button-compact" href="/feedback/">
          Send feedback <ArrowRight size={14} />
        </a>
        <a href="/knowledge/ask-jackalope/">Meet the helper</a>
      </div>
    </section>
  );
}

export function KnowledgebasePage({
  path = '/knowledge/',
  dark = false,
}: {
  path?: string;
  dark?: boolean;
}) {
  const normalized = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  const slug = normalized.replace(/^\/knowledge\/?/, '');
  const activeGuide = knowledgeGuides.find((guide) => guide.slug === slug);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GuideCategory | 'all'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const copyToClipboard = async (id: string, text: string) => {
    try {
      setCopyError('');
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopyError('Copy failed. Open the Markdown version and copy its text.');
    }
  };
  useEffect(() => {
    if (!activeGuide) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActiveHeadingId(entry.target.id);
      },
      { rootMargin: '-100px 0px -55% 0px' },
    );
    for (const section of activeGuide.sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [activeGuide]);
  const searchResults = useMemo(() => {
    const terms = words(query);
    if (!terms.length) return [];
    return knowledgeGuides
      .flatMap((guide) => {
        const title = `${guide.title} ${guide.shortTitle} ${guide.description}`.toLowerCase();
        const sections = guide.sections.map((section) => ({ section, text: sectionText(section) }));
        if (!matchesTerms(`${title} ${sections.map((item) => item.text).join(' ')}`, terms))
          return [];
        const matching = sections.find((item) => matchesTerms(item.text, terms));
        return [
          {
            guide,
            section: matching?.section,
            score: terms.filter((term) => matchesTerms(title, [term])).length,
          },
        ];
      })
      .sort((a, b) => b.score - a.score);
  }, [query]);
  const filteredGuides = knowledgeGuides.filter(
    (guide) => selectedCategory === 'all' || guide.category === selectedCategory,
  );
  const clearSearch = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  if (activeGuide) {
    return (
      <main id="main" className="knowledge-guide-page page-width">
        <nav className="article-breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Jackalope</a>
          <span aria-hidden="true">/</span>
          <a href="/knowledge/">Knowledgebase</a>
          <span aria-hidden="true">/</span>
          <span>{activeGuide.shortTitle}</span>
        </nav>
        <header className="knowledge-guide-header">
          <div className="knowledge-eyebrow">
            {categoryLabel(activeGuide.category)} <span>· {activeGuide.readingTime}</span>
          </div>
          <h1>{activeGuide.title}</h1>
          <p className="knowledge-guide-lede">{activeGuide.description}</p>
          <div className="knowledge-agent-actions">
            <button
              type="button"
              className="button button-primary button-compact"
              onClick={() => void copyToClipboard('guide', guideMarkdown(activeGuide, siteOrigin))}
            >
              {copiedId === 'guide' ? <Check size={16} /> : <Copy size={16} />}
              {copiedId === 'guide' ? 'Copied' : 'Copy for your agent'}
            </button>
            <a className="knowledge-agent-markdown" href={`${guideHref(activeGuide.slug)}index.md`}>
              Read Markdown
            </a>
          </div>
          <p className="knowledge-copy-status" role="status">
            {copiedId ? 'Copied to clipboard.' : ''}
          </p>
          {copyError && <p role="alert">{copyError}</p>}
        </header>
        <div className="knowledge-guide-layout">
          <aside className="knowledge-guide-sidebar">
            <a href="/knowledge/" className="knowledge-back-link">
              <ArrowLeft size={14} /> All guides
            </a>
            <details className="knowledge-toc" open>
              <summary>On this page</summary>
              <nav aria-label="On this page">
                {activeGuide.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    aria-current={activeHeadingId === section.id ? 'location' : undefined}
                  >
                    {section.question}
                  </a>
                ))}
              </nav>
            </details>
          </aside>
          <article className="knowledge-guide-content" aria-label={activeGuide.shortTitle}>
            {activeGuide.sections.map((section) => (
              <section key={section.id} id={section.id} className="knowledge-guide-section">
                <h2>{section.question}</h2>
                <KnowledgeMedia slug={activeGuide.slug} section={section.id} dark={dark} />
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.steps && (
                  <ol className="knowledge-steps">
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                {section.bullets && (
                  <ul className="knowledge-bullet-list">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
                {section.callout && (
                  <div className={`knowledge-callout knowledge-callout-${section.callout.kind}`}>
                    <Info size={19} aria-hidden="true" />
                    <div>
                      <strong>
                        {section.callout.kind === 'important'
                          ? 'Important'
                          : section.callout.kind === 'tip'
                            ? 'Tip'
                            : 'Good to know'}
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
                          void copyToClipboard(section.id, section.codeBox?.code ?? '')
                        }
                        aria-label={`Copy ${section.codeBox.title}`}
                      >
                        {copiedId === section.id ? <Check size={14} /> : <Copy size={14} />}
                        {copiedId === section.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre>
                      <code>{section.codeBox.code}</code>
                    </pre>
                  </div>
                )}
                {section.links && (
                  <nav
                    className="knowledge-section-links"
                    aria-label={`Related help: ${section.question}`}
                  >
                    {section.links.map((link) => (
                      <a key={link.href} href={link.href}>
                        {link.label}
                        <ArrowRight size={14} />
                      </a>
                    ))}
                  </nav>
                )}
              </section>
            ))}
            <a className="knowledge-back-link" href="/knowledge/">
              <ArrowLeft size={15} /> Browse all guides
            </a>
          </article>
        </div>
        <SupportLinks />
      </main>
    );
  }
  return (
    <main id="main" className="knowledge-hub-page page-width">
      <header className="knowledge-hero">
        <nav className="article-breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Jackalope</a>
          <span aria-hidden="true">/</span>
          <span>Knowledgebase</span>
        </nav>
        <div className="knowledge-hero-layout">
          <div>
            <h1>
              A little help.
              <br />
              More room to build.
            </h1>
            <p className="knowledge-lede">
              Get your first task moving, find your way around, or work through a snag. Start here.
            </p>
            <search className="knowledge-search-bar">
              <Search size={20} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search guides, tools, or an error…"
                aria-label="Search knowledgebase"
                aria-controls="knowledge-results"
              />
              {query && (
                <button type="button" onClick={clearSearch} aria-label="Clear search">
                  <X size={18} />
                </button>
              )}
            </search>
          </div>
          <aside className="knowledge-helper-card" aria-labelledby="helper-card-title">
            <span className="knowledge-eyebrow">Help inside your workspace</span>
            <h2 id="helper-card-title">You can ask Jackalope.</h2>
            <p>Find a guide, prepare a task, or preview a theme with your configured agent.</p>
            <a href="/knowledge/ask-jackalope/">
              Meet your helper <ArrowRight size={16} />
            </a>
            <a className="knowledge-helper-docs" href="/knowledge/llms.txt">
              Documentation for your agent
            </a>
          </aside>
        </div>
      </header>
      {query.trim() ? (
        <section
          id="knowledge-results"
          className="knowledge-search-results"
          aria-label="Search results"
        >
          <div className="knowledge-section-intro">
            <h2>Results for “{query}”</h2>
            <p role="status">
              {searchResults.length} matching {searchResults.length === 1 ? 'guide' : 'guides'}
            </p>
          </div>
          {searchResults.length ? (
            <div className="knowledge-search-list">
              {searchResults.map(({ guide, section }) => (
                <a
                  key={guide.slug}
                  className="knowledge-search-item"
                  href={`${guideHref(guide.slug)}${section ? `#${section.id}` : ''}`}
                >
                  <span className="knowledge-eyebrow">
                    {categoryLabel(guide.category)} · {guide.readingTime}
                  </span>
                  <h3>{guide.shortTitle}</h3>
                  <p>{section?.paragraphs[0] ?? guide.description}</p>
                  <span className="knowledge-card-link">
                    {section?.question ?? 'Read guide'} <ArrowRight size={15} />
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="knowledge-empty">
              <h3>No guides found yet</h3>
              <p>Try a shorter phrase such as “account”, “Git lock”, or “browser”.</p>
              <button
                type="button"
                className="button button-primary button-compact"
                onClick={clearSearch}
              >
                Browse all guides
              </button>
            </div>
          )}
        </section>
      ) : (
        <div id="knowledge-results">
          <section className="knowledge-start" aria-labelledby="knowledge-start-title">
            <div className="knowledge-section-intro">
              <h2 id="knowledge-start-title">A good place to start</h2>
              <p>From setting up to bringing your changes home.</p>
            </div>
            <div className="knowledge-start-grid">
              {startingPoints.map((point, index) => (
                <a key={point.slug} href={guideHref(point.slug)}>
                  <span className="knowledge-start-number">0{index + 1}</span>
                  <div>
                    <h3>{point.title}</h3>
                    <p>{point.description}</p>
                  </div>
                  <ArrowRight size={18} />
                </a>
              ))}
            </div>
          </section>
          <section className="knowledge-watch" aria-labelledby="knowledge-watch-title">
            <div className="knowledge-section-intro">
              <h2 id="knowledge-watch-title">See where things happen</h2>
              <p>Short, captioned walkthroughs with sample data. Play them inside each guide.</p>
            </div>
            <div className="knowledge-watch-grid">
              {knowledgeClips.map((clip) => (
                <a key={clip.id} href={`${guideHref(clip.slug)}#${clip.section}`}>
                  <div className="knowledge-watch-image">
                    <img
                      src={`/media/knowledge/${clip.id}.jpg`}
                      alt=""
                      width={1280}
                      height={720}
                      loading="lazy"
                      decoding="async"
                    />
                    <span>
                      <Play size={12} aria-hidden="true" />
                      {clip.seconds}s demo
                    </span>
                  </div>
                  <h3>{clip.title}</h3>
                  <p>{clip.description}</p>
                  <span className="knowledge-card-link">
                    Open guide <ArrowRight size={14} />
                  </span>
                </a>
              ))}
            </div>
          </section>
          <section className="knowledge-hub-guides" aria-labelledby="knowledge-browse-title">
            <div className="knowledge-section-intro">
              <h2 id="knowledge-browse-title">Find your next step</h2>
              <p>Practical guides for your workspace.</p>
            </div>
            <nav className="knowledge-category-bar" aria-label="Filter guides by topic">
              <button
                type="button"
                aria-pressed={selectedCategory === 'all'}
                onClick={() => setSelectedCategory('all')}
              >
                All guides
              </button>
              {guideCategories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  aria-pressed={selectedCategory === category.id}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.label}
                </button>
              ))}
            </nav>
            <p className="knowledge-filter-count" role="status">
              {filteredGuides.length} {filteredGuides.length === 1 ? 'guide' : 'guides'}
            </p>
            <div className="knowledge-hub-grid">
              {filteredGuides.map((guide) => (
                <a key={guide.slug} className="knowledge-hub-card" href={guideHref(guide.slug)}>
                  <div className="knowledge-eyebrow">
                    {categoryLabel(guide.category)} <span>· {guide.readingTime}</span>
                  </div>
                  <h3>{guide.shortTitle}</h3>
                  <p>{guide.description}</p>
                  <span className="knowledge-card-link">
                    Read guide <ArrowRight size={14} />
                  </span>
                </a>
              ))}
            </div>
          </section>
          <section className="knowledge-troubleshooting" aria-labelledby="knowledge-fix-title">
            <div className="knowledge-section-intro">
              <span className="knowledge-eyebrow">Hit a snag?</span>
              <h2 id="knowledge-fix-title">Start with what you’re seeing</h2>
              <p>Find the cause before retrying or changing your setup.</p>
            </div>
            <div className="knowledge-scenario-grid">
              {troubleshootingScenarios.map((scenario) => (
                <a
                  key={scenario.id}
                  href={`${guideHref(scenario.targetSlug)}${scenario.targetAnchor ? `#${scenario.targetAnchor}` : ''}`}
                >
                  <div>
                    <h3>{scenario.title}</h3>
                    <p>{scenario.quickFix}</p>
                  </div>
                  <ArrowRight size={18} />
                </a>
              ))}
            </div>
          </section>
        </div>
      )}
      <SupportLinks />
    </main>
  );
}
