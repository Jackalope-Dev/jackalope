import { EchoMark } from '@jackalope/brand/echo';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Compass,
  Bot,
  GitBranch,
  GitPullRequest,
  Gauge,
  Hammer,
  Laptop,
  MoveUpRight,
  Network,
  Rocket,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { roadmapHeadline, roadmapLede, roadmapStages } from './roadmap-content';
import { WaitlistButton } from './Signup';
import './roadmap.css';

const stageIcons = [Check, Hammer, Rocket, Compass];
const itemIcons = [
  [Bot, GitBranch, Wrench],
  [Sparkles, Laptop, ShieldCheck],
  [Users, GitPullRequest, Gauge],
  [Network, Smartphone, Users],
];

export function RoadmapPage() {
  const [selected, setSelected] = useState('now');

  return (
    <main id="main" className="roadmap-page">
      <header className="roadmap-hero">
        <div className="page-width roadmap-hero-grid">
          <div className="roadmap-intro">
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
        <Tabs.Root value={selected} onValueChange={setSelected}>
          <Tabs.List className="roadmap-stages" aria-label="Roadmap stages">
            {roadmapStages.map((stage, index) => {
              const Icon = stageIcons[index];
              return (
                <Tabs.Trigger key={stage.id} value={stage.id} className="roadmap-stage">
                  <span className="roadmap-stage-track">
                    <span className="roadmap-stage-symbol">
                      <Icon size={28} />
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
          {roadmapStages.map((stage, stageIndex) => {
            const ChapterIcon = stageIcons[stageIndex];
            return (
            <Tabs.Content key={stage.id} value={stage.id} className="roadmap-chapter">
              <div className="roadmap-chapter-intro">
                <div className="roadmap-chapter-art" aria-hidden="true"><ChapterIcon size={72} strokeWidth={1.25} /><span /><span /></div>
                <h2>{stage.title}</h2>
                <p className="roadmap-description">{stage.description}</p>
                <p className="roadmap-status">{stage.status}</p>
                <a className="text-link" href={stage.link.href}>
                  {stage.link.label}
                  <MoveUpRight size={16} />
                </a>
              </div>
              <div className="roadmap-items">
                {stage.items.map((item, itemIndex) => {
                  const ItemIcon = itemIcons[stageIndex][itemIndex];
                  return (
                  <details className="roadmap-item" key={item.title}>
                    <summary>
                      <span className="roadmap-item-icon"><ItemIcon size={24} strokeWidth={1.6} /></span>
                      <span className="roadmap-item-copy">
                        <strong>{item.title}</strong>
                        <span>{item.summary}</span>
                      </span>
                      <ChevronDown size={19} />
                    </summary>
                    <p>{item.detail}</p>
                  </details>
                  );
                })}
              </div>
            </Tabs.Content>
            );
          })}
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
        <EchoMark className="roadmap-follow-echo" animated={false} />
      </section>
    </main>
  );
}
