import {
  ArrowRight,
  Bot,
  ChartNoAxesColumn,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Cpu,
  GitBranch,
  Layers3,
  LifeBuoy,
  Palette,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type CategoryMeta,
  type KnowledgeCategory,
  type KnowledgeItem,
  knowledgeCategories,
  knowledgeItems,
} from './knowledge-content';

function getCategoryIcon(name: string) {
  switch (name) {
    case 'Sparkles':
      return <Sparkles size={16} />;
    case 'Bot':
      return <Bot size={16} />;
    case 'GitBranch':
      return <GitBranch size={16} />;
    case 'Cpu':
      return <Cpu size={16} />;
    case 'Layers3':
      return <Layers3 size={16} />;
    case 'Plug':
      return <Plug size={16} />;
    case 'ChartNoAxesColumn':
      return <ChartNoAxesColumn size={16} />;
    case 'Wrench':
      return <Wrench size={16} />;
    case 'ShieldCheck':
      return <ShieldCheck size={16} />;
    case 'Palette':
      return <Palette size={16} />;
    default:
      return <Sparkles size={16} />;
  }
}

export function KnowledgebasePage({ dark = false }: { dark?: boolean }) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory | 'all'>('all');
  const [activeShowcaseTab, setActiveShowcaseTab] = useState<'tasks' | 'review' | 'agents'>(
    'tasks',
  );
  const [openItems, setOpenItems] = useState<Set<string>>(
    () => new Set(['qs-first-project', 'routing-quota-handoff', 'trouble-cli-not-found']),
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Deep linking to item hash on mount and hashchange
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash) {
        setOpenItems((prev) => new Set([...prev, hash]));
        const element = document.getElementById(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const toggleItem = (id: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      // Ignore copy error
    }
  };

  // Filter items based on category and search query
  const filteredItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return knowledgeItems.filter((item) => {
      const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
      if (!matchesCategory) return false;
      if (!trimmed) return true;

      return (
        item.title.toLowerCase().includes(trimmed) ||
        item.summary.toLowerCase().includes(trimmed) ||
        item.details.some((d) => d.toLowerCase().includes(trimmed)) ||
        item.tags.some((t) => t.toLowerCase().includes(trimmed)) ||
        item.command?.toLowerCase().includes(trimmed) ||
        item.codeSnippet?.toLowerCase().includes(trimmed)
      );
    });
  }, [query, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: knowledgeItems.length };
    for (const item of knowledgeItems) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, []);

  return (
    <main id="main" className="knowledge-page page-width">
      <header className="knowledge-hero">
        <nav className="article-breadcrumbs" aria-label="Breadcrumbs">
          <a href="/">Jackalope</a>
          <span aria-hidden="true">/</span>
          <span>Knowledgebase</span>
        </nav>

        <div className="knowledge-badge">
          <LifeBuoy size={14} /> Documentation, Guides & Diagnostics
        </div>

        <h1>Jackalope Knowledgebase</h1>
        <p className="knowledge-lede">
          Everything you need to master Jackalope: real feature overviews, parallel worktree
          architecture, multi-account setup, automatic quota handoff, and actionable troubleshooting
          playbooks.
        </p>

        <div className="knowledge-search-wrapper">
          <Search className="knowledge-search-icon" size={20} />
          <input
            type="search"
            className="knowledge-search-input"
            placeholder="Search guides, error messages, CLI commands, or topics (e.g., '429', 'worktree lock', 'profiles')…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the knowledgebase"
          />
          {query && (
            <button
              type="button"
              className="knowledge-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="knowledge-categories" role="tablist" aria-label="Documentation categories">
          <button
            type="button"
            className={`knowledge-pill ${activeCategory === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCategory('all')}
            role="tab"
            aria-selected={activeCategory === 'all'}
          >
            All Topics
            <span className="knowledge-pill-badge">{categoryCounts.all}</span>
          </button>
          {knowledgeCategories.map((cat: CategoryMeta) => (
            <button
              type="button"
              key={cat.id}
              className={`knowledge-pill ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              role="tab"
              aria-selected={activeCategory === cat.id}
            >
              {getCategoryIcon(cat.iconName)}
              {cat.name}
              <span className="knowledge-pill-badge">{categoryCounts[cat.id] || 0}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Visual Architecture and Workflow Overview */}
      <section className="knowledge-visuals" aria-label="Core architecture workflows">
        <div className="knowledge-visual-card">
          <div className="knowledge-visual-header">
            <div className="knowledge-visual-icon">
              <GitBranch size={20} />
            </div>
            <h3>Parallel Git Worktrees</h3>
          </div>
          <p>
            Independent agents work in separate `.worktrees/` checkouts. File edits are isolated,
            preventing collisions before guarded integration into the target branch.
          </p>
          <div className="knowledge-diagram-svg-container" aria-hidden="true">
            <svg
              viewBox="0 0 340 120"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-auto"
              aria-hidden="true"
            >
              {/* Main branch line */}
              <line
                x1="20"
                y1="60"
                x2="320"
                y2="60"
                stroke="var(--color-accent-ink)"
                strokeWidth="2.5"
                strokeDasharray="4 4"
              />
              <circle cx="30" cy="60" r="6" fill="var(--color-accent-fill)" />
              <text
                x="30"
                y="85"
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="middle"
              >
                main HEAD
              </text>

              {/* Worktree 1 Fork */}
              <path
                d="M 60 60 Q 90 25 120 25 L 220 25 Q 250 25 280 60"
                stroke="var(--color-text-primary)"
                strokeWidth="2"
                fill="none"
              />
              <rect
                x="120"
                y="15"
                width="100"
                height="22"
                rx="6"
                fill="var(--color-surface-elevated)"
                stroke="var(--color-border-subtle)"
              />
              <text
                x="170"
                y="30"
                fill="var(--color-text-primary)"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
              >
                Task A (Codex)
              </text>

              {/* Worktree 2 Fork */}
              <path
                d="M 60 60 Q 90 95 120 95 L 220 95 Q 250 95 280 60"
                stroke="var(--color-text-secondary)"
                strokeWidth="2"
                fill="none"
              />
              <rect
                x="120"
                y="84"
                width="100"
                height="22"
                rx="6"
                fill="var(--color-surface-elevated)"
                stroke="var(--color-border-subtle)"
              />
              <text
                x="170"
                y="99"
                fill="var(--color-text-primary)"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
              >
                Task B (Claude)
              </text>

              {/* Integration Checkpoint */}
              <circle cx="280" cy="60" r="7" fill="#2ea043" />
              <text
                x="280"
                y="80"
                fill="#2ea043"
                fontSize="10"
                fontWeight="700"
                textAnchor="middle"
              >
                Verified
              </text>
            </svg>
          </div>
        </div>

        <div className="knowledge-visual-card">
          <div className="knowledge-visual-header">
            <div className="knowledge-visual-icon">
              <Cpu size={20} />
            </div>
            <h3>Automatic Quota Handoff</h3>
          </div>
          <p>
            When an agent hits provider 429 rate limits or rolling token window caps, Jackalope
            preserves all edits and diffs, cleanly rerouting to an eligible fallback agent.
          </p>
          <div className="knowledge-diagram-svg-container" aria-hidden="true">
            <svg
              viewBox="0 0 340 120"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-auto"
              aria-hidden="true"
            >
              {/* Step 1 */}
              <rect
                x="10"
                y="45"
                width="80"
                height="32"
                rx="6"
                fill="var(--color-surface-elevated)"
                stroke="var(--color-border-subtle)"
              />
              <text
                x="50"
                y="65"
                fill="var(--color-text-primary)"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
              >
                Agent 1 (Active)
              </text>

              {/* Arrow with 429 */}
              <line
                x1="90"
                y1="61"
                x2="140"
                y2="61"
                stroke="var(--color-text-muted)"
                strokeWidth="2"
              />
              <circle cx="115" cy="61" r="9" fill="#d73a49" />
              <text x="115" y="64" fill="#fff" fontSize="8" fontWeight="700" textAnchor="middle">
                429
              </text>

              {/* Step 2 Handoff */}
              <rect
                x="140"
                y="35"
                width="95"
                height="52"
                rx="8"
                fill="var(--color-surface-elevated)"
                stroke="var(--color-accent-ink)"
                strokeWidth="1.5"
              />
              <text
                x="187"
                y="54"
                fill="var(--color-accent-ink)"
                fontSize="9"
                fontWeight="700"
                textAnchor="middle"
              >
                PRESERVE WORK
              </text>
              <text
                x="187"
                y="72"
                fill="var(--color-text-secondary)"
                fontSize="9"
                textAnchor="middle"
              >
                Diffs & Receipts
              </text>

              {/* Arrow to fallback */}
              <line
                x1="235"
                y1="61"
                x2="260"
                y2="61"
                stroke="var(--color-accent-ink)"
                strokeWidth="2"
              />

              {/* Step 3 Fallback */}
              <rect x="260" y="45" width="70" height="32" rx="6" fill="#2ea043" stroke="#2ea043" />
              <text x="295" y="65" fill="#fff" fontSize="10" fontWeight="600" textAnchor="middle">
                Fallback
              </text>
            </svg>
          </div>
        </div>

        <div className="knowledge-visual-card">
          <div className="knowledge-visual-header">
            <div className="knowledge-visual-icon">
              <ShieldCheck size={20} />
            </div>
            <h3>Local Security Perimeter</h3>
          </div>
          <p>
            Zero proprietary repository code or prompts are sent to Jackalope cloud. All state lives
            in local SQLite profiles, using an isolated local loopback socket.
          </p>
          <div className="knowledge-diagram-svg-container" aria-hidden="true">
            <svg
              viewBox="0 0 340 120"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-auto"
              aria-hidden="true"
            >
              {/* Local Box */}
              <rect
                x="10"
                y="15"
                width="200"
                height="90"
                rx="10"
                fill="rgba(46, 160, 67, 0.08)"
                stroke="#2ea043"
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />
              <text x="25" y="32" fill="#2ea043" fontSize="9" fontWeight="700">
                100% LOCAL DEVICE PERIMETER
              </text>

              <rect
                x="25"
                y="45"
                width="80"
                height="45"
                rx="6"
                fill="var(--color-surface-elevated)"
                stroke="var(--color-border-subtle)"
              />
              <text
                x="65"
                y="63"
                fill="var(--color-text-primary)"
                fontSize="9"
                fontWeight="600"
                textAnchor="middle"
              >
                Local Git Repos
              </text>
              <text
                x="65"
                y="77"
                fill="var(--color-text-secondary)"
                fontSize="8"
                textAnchor="middle"
              >
                + SQLite Profile
              </text>

              <line
                x1="105"
                y1="67"
                x2="135"
                y2="67"
                stroke="var(--color-text-muted)"
                strokeWidth="2"
              />

              <rect
                x="135"
                y="45"
                width="65"
                height="45"
                rx="6"
                fill="var(--color-surface-elevated)"
                stroke="var(--color-border-subtle)"
              />
              <text
                x="167"
                y="63"
                fill="var(--color-text-primary)"
                fontSize="9"
                fontWeight="600"
                textAnchor="middle"
              >
                Loopback
              </text>
              <text
                x="167"
                y="77"
                fill="var(--color-text-secondary)"
                fontSize="8"
                textAnchor="middle"
              >
                Coordinator
              </text>

              {/* External Provider */}
              <line
                x1="210"
                y1="67"
                x2="245"
                y2="67"
                stroke="var(--color-accent-ink)"
                strokeWidth="2"
              />
              <rect
                x="245"
                y="35"
                width="85"
                height="55"
                rx="8"
                fill="var(--color-surface-elevated)"
                stroke="var(--color-border-subtle)"
              />
              <text
                x="287"
                y="58"
                fill="var(--color-text-primary)"
                fontSize="9"
                fontWeight="600"
                textAnchor="middle"
              >
                Provider API
              </text>
              <text
                x="287"
                y="73"
                fill="var(--color-text-secondary)"
                fontSize="8"
                textAnchor="middle"
              >
                (Your Key / Account)
              </text>
            </svg>
          </div>
        </div>
      </section>

      {/* Visual Workflow Showcase */}
      <section
        className="knowledge-showcase-section"
        aria-label="Desktop app workflow visual showcase"
      >
        <div className="knowledge-showcase-header">
          <div>
            <span className="knowledge-diagrams-pill">App Workflows</span>
            <h2>Visual Interface Tour</h2>
            <p className="knowledge-lede">
              Explore how Jackalope coordinates isolated Git worktrees, unified Pierre diffs, and
              multi-agent lineups in a single native desktop window.
            </p>
          </div>
          <div className="knowledge-showcase-tabs" role="tablist" aria-label="Workflow previews">
            <button
              type="button"
              role="tab"
              aria-selected={activeShowcaseTab === 'tasks'}
              className={`knowledge-showcase-tab ${activeShowcaseTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setActiveShowcaseTab('tasks')}
            >
              <GitBranch size={16} /> Parallel Tasks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeShowcaseTab === 'review'}
              className={`knowledge-showcase-tab ${activeShowcaseTab === 'review' ? 'active' : ''}`}
              onClick={() => setActiveShowcaseTab('review')}
            >
              <CheckCheck size={16} /> Diff Review
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeShowcaseTab === 'agents'}
              className={`knowledge-showcase-tab ${activeShowcaseTab === 'agents' ? 'active' : ''}`}
              onClick={() => setActiveShowcaseTab('agents')}
            >
              <Bot size={16} /> Multi-Agent Hub
            </button>
          </div>
        </div>

        <div className="knowledge-showcase-window">
          {activeShowcaseTab === 'tasks' && (
            <div className="knowledge-showcase-content">
              <div className="knowledge-showcase-frame">
                <img
                  src={`/media/tasks${dark ? '' : '-light'}.png`}
                  alt="Jackalope parallel tasks interface showing running agent jobs in separate worktrees"
                  width="1440"
                  height="840"
                  loading="lazy"
                />
              </div>
              <div className="knowledge-showcase-caption">
                <strong>Isolated Task Execution</strong>
                <p>
                  Every task receives a unique worktree directory under{' '}
                  <code>.worktrees/&lt;task-id&gt;</code> with dedicated Git index and terminal
                  process. You can switch between active agents without any file collisions or lost
                  editor context.
                </p>
              </div>
            </div>
          )}

          {activeShowcaseTab === 'review' && (
            <div className="knowledge-showcase-content">
              <div className="knowledge-showcase-frame">
                <img
                  src={`/media/review${dark ? '' : '-light'}.png`}
                  alt="Jackalope code review view featuring Pierre unified diffs and hunk acceptance"
                  width="1440"
                  height="840"
                  loading="lazy"
                />
              </div>
              <div className="knowledge-showcase-caption">
                <strong>Guarded Multi-File Diff Review</strong>
                <p>
                  Powered by high-performance Pierre diffing. Inspect color-coded additions,
                  deletions, and syntax highlights. Stash, discard, or accept individual hunks
                  before squashing or merging into your working branch.
                </p>
              </div>
            </div>
          )}

          {activeShowcaseTab === 'agents' && (
            <div className="knowledge-showcase-content">
              <div className="knowledge-showcase-frame">
                <img
                  src={`/media/agents${dark ? '' : '-light'}.png`}
                  alt="Jackalope agent management screen showing configured CLI adapters and sign-in profiles"
                  width="1440"
                  height="840"
                  loading="lazy"
                />
              </div>
              <div className="knowledge-showcase-caption">
                <strong>Bring Your Own Agent CLIs</strong>
                <p>
                  Connect Codex, Claude Code, Grok, OpenCode, and local LLMs. Create independent
                  work and personal sign-in profiles, set per-project agent permissions, and
                  configure automatic quota handoff rules.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Main Knowledgebase Accordion List */}
      <section aria-label="Knowledgebase articles and guides">
        <div className="knowledge-list-header">
          <h2>
            {activeCategory === 'all'
              ? 'All Articles & Guides'
              : knowledgeCategories.find((c) => c.id === activeCategory)?.name}
          </h2>
          <div className="knowledge-list-controls">
            <span className="knowledge-list-count">
              Showing {filteredItems.length} {filteredItems.length === 1 ? 'topic' : 'topics'}
            </span>
            {filteredItems.length > 0 && (
              <button
                type="button"
                className="knowledge-toggle-all-btn"
                onClick={() => {
                  const allOpen = filteredItems.every((item) => openItems.has(item.id));
                  if (allOpen) {
                    setOpenItems(new Set());
                  } else {
                    setOpenItems(new Set(filteredItems.map((item) => item.id)));
                  }
                }}
              >
                {filteredItems.every((item) => openItems.has(item.id))
                  ? 'Collapse all'
                  : 'Expand all'}
              </button>
            )}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="knowledge-empty">
            <h3>No matching articles found</h3>
            <p>
              Try searching for a different keyword, error phrase, or clear your category filter.
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setQuery('');
                setActiveCategory('all');
              }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="knowledge-list">
            {filteredItems.map((item: KnowledgeItem) => {
              const isOpen = openItems.has(item.id);
              const categoryMeta = knowledgeCategories.find((c) => c.id === item.category);

              return (
                <article
                  key={item.id}
                  id={item.id}
                  className={`knowledge-card ${isOpen ? 'open' : ''}`}
                >
                  <button
                    type="button"
                    className="knowledge-card-summary text-left w-full"
                    onClick={() => toggleItem(item.id)}
                    aria-expanded={isOpen}
                    aria-controls={`content-${item.id}`}
                  >
                    <div className="knowledge-card-title-area">
                      <div className="knowledge-card-meta">
                        <span className="knowledge-card-category-tag">
                          {categoryMeta?.name ?? item.category}
                        </span>
                        {item.isFaq && <span className="knowledge-card-faq-pill">FAQ</span>}
                      </div>
                      <h3>{item.title}</h3>
                      <p className="knowledge-card-preview">{item.summary}</p>
                    </div>
                    <div className="knowledge-card-toggle" aria-hidden="true">
                      <ChevronDown size={18} />
                    </div>
                  </button>

                  {isOpen && (
                    <div id={`content-${item.id}`} className="knowledge-card-content">
                      {item.details.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}

                      {item.bullets && item.bullets.length > 0 && (
                        <ul className="knowledge-card-bullets">
                          {item.bullets.map((bullet) => (
                            <li key={bullet}>
                              <Check size={16} />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {item.command && (
                        <div className="knowledge-terminal-box">
                          <div className="knowledge-terminal-header">
                            <span>TERMINAL COMMAND</span>
                            <button
                              type="button"
                              className={`knowledge-copy-button ${copiedId === item.id ? 'copied' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(item.id, item.command || '');
                              }}
                              aria-label="Copy terminal command"
                            >
                              {copiedId === item.id ? (
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
                          <pre className="knowledge-terminal-code">{item.command}</pre>
                        </div>
                      )}

                      {item.codeSnippet && (
                        <div className="knowledge-terminal-box">
                          <div className="knowledge-terminal-header">
                            <span>EXAMPLE CONFIGURATION</span>
                            <button
                              type="button"
                              className={`knowledge-copy-button ${copiedId === `${item.id}-snippet` ? 'copied' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(`${item.id}-snippet`, item.codeSnippet || '');
                              }}
                              aria-label="Copy code snippet"
                            >
                              {copiedId === `${item.id}-snippet` ? (
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
                          <pre className="knowledge-terminal-code">{item.codeSnippet}</pre>
                        </div>
                      )}

                      <div className="knowledge-card-tags">
                        {item.tags.map((tag) => (
                          <button
                            type="button"
                            key={tag}
                            className="knowledge-tag"
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuery(tag);
                            }}
                            title={`Search for "${tag}"`}
                            aria-label={`Search for ${tag}`}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer Support Banner */}
      <aside className="knowledge-footer-banner" aria-labelledby="knowledge-help-title">
        <div>
          <h3 id="knowledge-help-title">Need help with something not covered here?</h3>
          <p>
            Generate an unredacted local diagnostics report in Settings → Updates & support, or
            share private feedback with the engineering team.
          </p>
        </div>
        <div className="knowledge-footer-actions">
          <a className="button button-primary" href="/feedback/">
            Send feedback <ArrowRight size={16} />
          </a>
          <a className="button button-secondary" href="/tour/">
            Watch app tour
          </a>
        </div>
      </aside>
    </main>
  );
}
