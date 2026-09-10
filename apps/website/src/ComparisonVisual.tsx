import { ArrowDown, ArrowRight, Check, GitBranch, Layers, Monitor, Users } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { comparisonPages, terminalComparison } from './comparison-content';
import type { MarketingPage } from './marketing-content';

type Comparison = NonNullable<MarketingPage['comparison']>;

export function ComparisonVisual({ comparison }: { comparison: Comparison }) {
  return (
    <section className="comparison-visual" aria-label="The comparison in brief">
      <div className="comparison-visual-heading">
        <GitBranch size={16} aria-hidden="true" /> Two ways to work
      </div>
      <div className="comparison-contenders">
        <div className="comparison-contender comparison-contender-brand">
          <span className="comparison-emblem">
            <BrandMark />
          </span>
          <h2>Jackalope</h2>
          <p>{comparison.overview.jackalope}</p>
          <span className="comparison-availability">Coming soon</span>
        </div>
        <div className="comparison-contender">
          <span className="comparison-emblem" aria-hidden="true">
            {comparison.name[0]}
          </span>
          <h2>{comparison.name}</h2>
          <p>{comparison.overview.competitor}</p>
        </div>
      </div>
      <div className="comparison-common">
        <h3>Common ground</h3>
        <ul>
          {comparison.overview.shared.map((item) => (
            <li key={item}>
              <Check size={14} aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        <p>Shared capabilities, with different approaches.</p>
      </div>
      <a className="comparison-visual-link" href="#at-a-glance">
        See the differences <ArrowDown size={16} aria-hidden="true" />
      </a>
    </section>
  );
}

export function ComparisonGuide() {
  return (
    <div className="comparison-guide">
      <span className="comparison-emblem comparison-guide-brand">
        <BrandMark />
      </span>
      <h2>Find your kind of workspace.</h2>
      <div>
        <Monitor size={21} aria-hidden="true" />
        <span>
          <strong>Where it runs</strong>Local machine or remote host?
        </span>
      </div>
      <div>
        <Users size={21} aria-hidden="true" />
        <span>
          <strong>Who takes part</strong>Your agents or your whole team?
        </span>
      </div>
      <div>
        <GitBranch size={21} aria-hidden="true" />
        <span>
          <strong>How work comes together</strong>Individual branches or dependent tasks?
        </span>
      </div>
      <a className="comparison-visual-link" href="#browse-comparisons">
        Explore the alternatives <ArrowDown size={16} aria-hidden="true" />
      </a>
    </div>
  );
}

export function ComparisonDirectory() {
  const entries = [
    ...comparisonPages.flatMap((page) =>
      page.comparison ? [{ path: page.path, comparison: page.comparison }] : [],
    ),
    { path: '/compare/terminal-tabs/', comparison: terminalComparison },
  ];
  return (
    <section id="browse-comparisons" className="comparison-overview">
      <div>
        <span className="comparison-eyebrow">Explore the alternatives</span>
        <h2>Same goal. Different ways to get there.</h2>
        <p>
          Start with what matters to you. Each comparison shows the common ground, the differences,
          and the sources behind them.
        </p>
        <div className="comparison-directory">
          {entries.map(({ path, comparison }) => (
            <a className="comparison-directory-card" href={path} key={path}>
              <span className="comparison-directory-top">
                <span className="comparison-emblem" aria-hidden="true">
                  {comparison.name[0]}
                </span>
                <ArrowRight size={19} aria-hidden="true" />
              </span>
              <span className="comparison-eyebrow">Jackalope vs</span>
              <h3>{comparison.name}</h3>
              <p>{comparison.overview.competitor}</p>
              <span className="comparison-directory-shared">
                <Layers size={14} aria-hidden="true" />
                {comparison.overview.shared.slice(0, 2).join(' · ')}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ComparisonWorkflows({ comparison }: { comparison: Comparison }) {
  return (
    <div className="comparison-workflows">
      {comparison.rows.map((row, index) => (
        <section
          className="comparison-workflow"
          key={row.topic}
          aria-labelledby={`workflow-${index}`}
        >
          <h3 id={`workflow-${index}`}>
            <span>0{index + 1}</span>
            {row.topic}
          </h3>
          <div className="comparison-workflow-pair">
            <div>
              <span className="comparison-workflow-label">
                <BrandMark />
                Jackalope
              </span>
              <p>{row.jackalope}</p>
            </div>
            <div>
              <span className="comparison-workflow-label">{comparison.name}</span>
              <p>{row.competitor}</p>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
