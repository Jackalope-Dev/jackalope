import { EchoMark } from '@jackalope/brand/echo';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Compass,
  Hammer,
  MoveUpRight,
} from 'lucide-react';
import { useState } from 'react';
import { roadmapHeadline, roadmapLede, roadmapStages } from './roadmap-content';
import { WaitlistButton } from './Signup';
import './roadmap.css';

const stageIcons = [Check, Hammer, ArrowRight, Compass];

export function RoadmapPage() {
  const [selected, setSelected] = useState('now');

  return (
    <main id="main" className="roadmap-page">
      <header className="roadmap-hero">
        <div className="page-width roadmap-hero-grid">
          <div className="roadmap-intro">
            <nav className="article-breadcrumbs" aria-label="Breadcrumb">
              <a href="/">Jackalope</a>
              <span aria-hidden="true">/</span>
              <span>Roadmap</span>
            </nav>
            <h1>{roadmapHeadline}</h1>
            <p>{roadmapLede}</p>
            <a className="text-link roadmap-explore" href="#journey">
              Explore the journey <ArrowDown size={17} />
            </a>
          </div>
          <div className="roadmap-horizon">
            <div className="roadmap-echo">
              <EchoMark animated={false} />
            </div>
            <div className="roadmap-position">
              <span className="roadmap-position-label">
                <Hammer size={15} /> Where we are
              </span>
              <strong>
                Built locally.
                <br />
                Getting ready for you.
              </strong>
              <p>Coming soon. We’re working toward a dependable first release.</p>
            </div>
          </div>
        </div>
      </header>

      <section id="journey" className="page-width roadmap-journey" aria-label="Explore the roadmap">
        <div className="roadmap-map-heading">
          <span>From the first task to what’s possible next.</span>
          <span>Direction, not deadlines.</span>
        </div>
        <Tabs.Root value={selected} onValueChange={setSelected}>
          <Tabs.List className="roadmap-stages" aria-label="Roadmap stages">
            {roadmapStages.map((stage, index) => {
              const Icon = stageIcons[index];
              return (
                <Tabs.Trigger key={stage.id} value={stage.id} className="roadmap-stage">
                  <span className="roadmap-stage-track">
                    <span className="roadmap-stage-symbol">
                      <Icon size={19} />
                    </span>
                  </span>
                  <span className="roadmap-stage-label">{stage.label}</span>
                  <span className="roadmap-stage-caption">{stage.caption}</span>
                  <span className="roadmap-stage-cue">
                    {stage.id === 'now' ? 'We are here' : 'Explore'}
                    <ArrowDown size={13} />
                  </span>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
          {roadmapStages.map((stage) => (
            <Tabs.Content key={stage.id} value={stage.id} className="roadmap-chapter">
              <div className="roadmap-chapter-intro">
                <p className="roadmap-status">{stage.status}</p>
                <h2>{stage.title}</h2>
                <p className="roadmap-description">{stage.description}</p>
                <a className="text-link" href={stage.link.href}>
                  {stage.link.label}
                  <MoveUpRight size={16} />
                </a>
              </div>
              <div className="roadmap-items">
                {stage.items.map((item) => (
                  <details className="roadmap-item" key={item.title}>
                    <summary>
                      <span>
                        <strong>{item.title}</strong>
                        <span>{item.summary}</span>
                      </span>
                      <ChevronDown size={19} />
                    </summary>
                    <p>{item.detail}</p>
                  </details>
                ))}
                <p className="roadmap-chapter-note">
                  <ArrowRight size={16} />
                  {stage.next}
                </p>
              </div>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </section>

      <section className="page-width roadmap-follow" aria-labelledby="roadmap-follow-title">
        <div>
          <h2 id="roadmap-follow-title">Help shape the next chapter.</h2>
          <p>
            Join the waitlist, tell us how you want to work, and follow along as Jackalope takes
            shape.
          </p>
          <div className="roadmap-follow-actions">
            <WaitlistButton />
            <a className="text-link" href="/changelog/">
              See what’s changed
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
        <div className="roadmap-promise">
          <Compass size={24} />
          <h3>A direction we’ll keep refining.</h3>
          <p>
            Built means implemented in the prerelease app. Planned and exploring features are future
            work. Priorities may change as we learn; we haven’t announced a public launch date.
          </p>
        </div>
      </section>
    </main>
  );
}
