import { ChevronRight } from 'lucide-react';
import { botActivity, botConversations } from '../../lib/bot-conversations';
import { needsYou } from '../../lib/bot-hub';
import type { LiveSession } from '../../lib/live-session';
import type { TaskRun } from '../../lib/run-types';
import { type Bot, botProjectIds, rosterOrder } from '../../stores/botStore';
import type { Project } from '../../stores/projectStore';
import { BotAvatar } from './BotAvatar';

const SHOWN = 6;

/** Every project as a card with the bots that work in it; choosing one opens that project. */
export function BotProjects({
  projects,
  bots,
  sessions,
  runs,
  hub,
  onOpen,
}: {
  projects: Project[];
  bots: Bot[];
  sessions: LiveSession[];
  runs: TaskRun[];
  hub: Parameters<typeof needsYou>[0];
  onOpen: (projectId: string) => void;
}) {
  return (
    <ul className="bots-projects workspace-card-grid" aria-label="Projects">
      {projects.map((project) => {
        const members = rosterOrder(bots).filter((bot) => botProjectIds(bot).includes(project.id));
        const states = members.map((bot) => ({
          bot,
          activity: botActivity(
            botConversations(sessions, bot.id).filter(
              (session) => session.request.projectId === project.id,
            ),
            runs,
          ),
          shared: botProjectIds(bot).length > 1,
        }));
        const working = states.filter((item) => item.activity === 'working').length;
        const waiting = members.reduce((total, bot) => total + needsYou(hub, bot.id).count, 0);
        const summary = [
          `${members.length} ${members.length === 1 ? 'bot' : 'bots'}`,
          working ? `${working} working` : '',
          waiting ? `${waiting} waiting on you` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const accent = project.preferences?.theme?.accentHex;
        return (
          <li key={project.id}>
            <button
              type="button"
              className="bots-project"
              data-empty={members.length ? undefined : true}
              onClick={() => onOpen(project.id)}
            >
              <span className="bots-project-heading">
                <span
                  className="bots-project-mark"
                  aria-hidden="true"
                  style={accent ? { background: accent } : undefined}
                />
                <strong title={project.name}>{project.name}</strong>
                <ChevronRight size={16} aria-hidden="true" />
              </span>
              <span className="bots-project-crew" aria-hidden={members.length > 0 || undefined}>
                {states.slice(0, SHOWN).map(({ bot, activity, shared }) => (
                  <span
                    key={bot.id}
                    className="bots-project-member"
                    data-shared={shared || undefined}
                    title={`${bot.name}${shared ? ' · also in other projects' : ''}`}
                  >
                    <BotAvatar appearance={bot.appearance} agent={bot.agent} state={activity} />
                  </span>
                ))}
                {!members.length && <span className="bots-project-hint">No bots yet</span>}
                {members.length > SHOWN && (
                  <span className="bots-project-more">+{members.length - SHOWN}</span>
                )}
              </span>
              {members.length > 0 && (
                <small className="bots-project-summary" data-waiting={waiting > 0 || undefined}>
                  {summary}
                </small>
              )}
              <span className="sr-only">
                {members.length ? `: ${members.map((bot) => bot.name).join(', ')}` : ''}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
