import { Badge, Checkbox, Choice } from '@jackalope/ui';
import { useState } from 'react';
import { providerLabel, type SwarmHosts, setProjectHosts } from '../../lib/computers';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { SettingBody, SettingGroup } from '../settings/Setting';
import { InlineNotice } from '../ui/InlineNotice';
import { HostCapacity, useProjectHosts } from './HostCapacity';
import './computers.css';

const CHOICES: { value: SwarmHosts; title: string; description: string }[] = [
  {
    value: 'anywhere',
    title: 'Anywhere',
    description:
      'This device and the computers below. Work goes to the project’s computer when it has one, and to the least busy host when that is full.',
  },
  {
    value: 'computers',
    title: 'Computers only',
    description:
      'Work that only this device can run, such as an agent that cannot run on a computer, stops with the reason.',
  },
  {
    value: 'device',
    title: 'This device only',
    description: 'Planned and swarm work, planners and orchestrators included, stay here.',
  },
];

/**
 * Where a project's planned and swarm work may run, and which other computers
 * it may use besides the project's own.
 */
export function ProjectSwarmHosts({ projectId }: { projectId: string }) {
  const { hosts, setHosts, error: loadError } = useProjectHosts(projectId, 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isTauriEnvironment()) return null;
  // With no computer to run on there is nothing to choose.
  if (hosts && !hosts.chosen && !hosts.computers.length && hosts.hosts.every((h) => h.device))
    return null;
  const added = hosts?.computers.filter((computer) => computer.added).map(({ id }) => id) ?? [];
  const save = async (swarmHosts: SwarmHosts, computers: string[]) => {
    setBusy(true);
    setError('');
    try {
      setHosts(await setProjectHosts(projectId, swarmHosts, computers));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingGroup
      title={
        <span className="inline-flex items-center gap-2">
          Swarms run on <Badge variant="accent">Beta</Badge>
        </span>
      }
      description="Where planned and swarm work may run. Each assignment goes to a host that has what it needs and a free slot, and its activity says why. Checks, review and merging stay on this device."
    >
      {(error || loadError) && (
        <SettingBody>
          <InlineNotice tone="error">{error || loadError}</InlineNotice>
        </SettingBody>
      )}
      {hosts && (
        <>
          <SettingBody>
            <fieldset className="swarm-hosts-choices">
              <legend className="swarm-hosts-legend">Swarms run on</legend>
              {CHOICES.map((choice) => (
                <Choice
                  key={choice.value}
                  selected={hosts.swarmHosts === choice.value}
                  title={choice.title}
                  description={choice.description}
                  disabled={busy}
                  onClick={() => void save(choice.value, added)}
                />
              ))}
            </fieldset>
          </SettingBody>
          {hosts.swarmHosts !== 'device' && hosts.computers.length > 0 && (
            <SettingBody>
              <fieldset className="swarm-hosts-choices">
                <legend className="swarm-hosts-legend">Also use</legend>
                {hosts.computers.map((computer) => (
                  <label key={computer.id} className="ui-choice">
                    <Checkbox
                      checked={computer.added}
                      disabled={busy}
                      onChange={(event) =>
                        void save(
                          hosts.swarmHosts,
                          event.target.checked
                            ? [...added, computer.id]
                            : added.filter((id) => id !== computer.id),
                        )
                      }
                    />
                    <span className="ui-choice-body">
                      <span className="ui-choice-title">{computer.name}</span>
                      <span className="ui-choice-description">
                        {providerLabel(computer.provider)}
                        {computer.ownerKind === 'bot' ? ' · a bot’s computer' : ''} · two runs at a
                        time unless its image reports more
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </SettingBody>
          )}
          <SettingBody>
            <HostCapacity projectId={projectId} />
          </SettingBody>
        </>
      )}
    </SettingGroup>
  );
}
