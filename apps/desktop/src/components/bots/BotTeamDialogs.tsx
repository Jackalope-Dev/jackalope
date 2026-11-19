import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  CopyButton,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  InlineNotice,
  Textarea,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, FileUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  exportBotTeam,
  parseBotTeam,
  TEAM_FILE_SUFFIX,
  TEAM_TEXT_MAX,
  type TeamImport,
  teamFileName,
  uniqueBotNames,
} from '../../lib/bot-team';
import { type Bot, useBotStore } from '../../stores/botStore';
import type { Project } from '../../stores/projectStore';
import { ActionError } from '../ui/ActionError';
import { BotAvatar } from './BotAvatar';

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  createWritable: () => Promise<{
    write: (text: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

/** Saves through the system's save dialog where the webview has one, else as a download. */
async function saveTextFile(name: string, text: string) {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    const handle = await picker({
      suggestedName: name,
      types: [{ description: 'Jackalope bots', accept: { 'application/json': ['.json'] } }],
    });
    const file = await handle.createWritable();
    await file.write(text);
    await file.close();
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function BotList({
  bots,
}: {
  bots: Pick<Bot, 'name' | 'role' | 'appearance' | 'agent' | 'wakes'>[];
}) {
  return (
    <ul className="bots-team-list">
      {bots.map((bot) => (
        <li key={bot.name} className="bots-team-item">
          <BotAvatar appearance={bot.appearance} agent={bot.agent} />
          <span className="bots-team-name">{bot.name}</span>
          <span className="task-muted bots-team-role">
            {[bot.role, bot.wakes.length ? plural(bot.wakes.length, 'wake-up') : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Saves a project's bots as one file someone else can add. */
export function ShareBotsDialog({
  project,
  bots,
  onClose,
}: {
  project: Project;
  bots: Bot[];
  onClose: () => void;
}) {
  const team = useMemo(() => exportBotTeam(`${project.name} bots`, bots), [project.name, bots]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try {
      await saveTextFile(teamFileName(project.name), team.text);
      setSaved(true);
    } catch (cause) {
      // Closing the save dialog is not a failure.
      if ((cause as { name?: string })?.name !== 'AbortError') setError(describeError(cause));
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bots-team-dialog">
        <DialogCloseButton />
        <DialogHeader
          title={`Share ${project.name}'s bots`}
          description="The file holds each bot's name, description, instructions, look and wake-ups. Agents, models, projects, connections, notes and conversations stay on this computer."
        />
        <BotList bots={bots} />
        {team.notes.map((note) => (
          <InlineNotice key={note} tone="warning">
            {note}
          </InlineNotice>
        ))}
        {saved && (
          <InlineNotice tone="success">Saved. Anyone can add it with Import bots.</InlineNotice>
        )}
        <ActionError error={error} />
        <DialogFooter>
          <CopyButton variant="outline" text={team.text} label="Copy as text" />
          <Button onClick={() => void save()}>
            <Download size={16} aria-hidden="true" /> Save file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

/** Reviews a bot file and adds its bots to a project. Nothing is added before the review. */
export function ImportBotsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [source, setSource] = useState('');
  const [team, setTeam] = useState<TeamImport | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const review = (text: string) => {
    setError('');
    try {
      setTeam(parseBotTeam(text));
    } catch (cause) {
      setTeam(null);
      setError(describeError(cause));
    }
  };
  const load = async (file?: File) => {
    if (!file) return;
    if (file.size > TEAM_TEXT_MAX) return setError('This file is too large to be a bot file.');
    const text = await file.text();
    setSource(text);
    review(text);
  };
  const add = () => {
    if (!team) return;
    const store = useBotStore.getState();
    const names = uniqueBotNames(
      team.bots.map((bot) => bot.name),
      store.bots.map((bot) => bot.name),
    );
    try {
      let first: string | undefined;
      team.bots.forEach((bot, index) => {
        const id = store.create({ ...bot, name: names[index], projectId: project.id });
        first ??= id;
      });
      if (first) useBotStore.getState().openConversation(null, first);
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    }
  };
  const wakes = team?.bots.reduce((total, bot) => total + bot.wakes.length, 0) ?? 0;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bots-team-dialog">
        <DialogCloseButton />
        <DialogHeader
          title={team ? `Add ${team.name} to ${project.name}` : `Import bots to ${project.name}`}
          description={
            team
              ? `New bots use Automatic for their agent and no connections until you choose them.${wakes ? ' Wake-ups arrive turned off.' : ''}`
              : 'Choose a bot file someone shared, or paste its text. You review the bots before anything is added.'
          }
        />
        {team ? (
          <>
            <BotList bots={team.bots} />
            {team.notes.map((note) => (
              <InlineNotice key={note} tone="warning">
                {note}
              </InlineNotice>
            ))}
          </>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={`application/json,.json,${TEAM_FILE_SUFFIX}`}
              className="hidden"
              aria-label="Choose a bot file"
              onChange={(event) => {
                void load(event.target.files?.[0]).catch((cause) => setError(describeError(cause)));
                event.target.value = '';
              }}
            />
            <Textarea
              aria-label="Bot file text"
              className="task-input w-full font-mono text-xs"
              style={{ minHeight: 160, resize: 'vertical' }}
              maxLength={TEAM_TEXT_MAX}
              value={source}
              placeholder="Paste a bot file here"
              spellCheck={false}
              onChange={(event) => {
                setSource(event.target.value);
                setError('');
              }}
            />
          </>
        )}
        <ActionError error={error} />
        <DialogFooter>
          {team ? (
            <>
              <Button variant="outline" onClick={() => setTeam(null)}>
                Back
              </Button>
              <Button onClick={add}>Add {plural(team.bots.length, 'bot')}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <FileUp size={16} aria-hidden="true" /> Choose file
              </Button>
              <Button disabled={!source.trim()} onClick={() => review(source)}>
                Review bots
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
