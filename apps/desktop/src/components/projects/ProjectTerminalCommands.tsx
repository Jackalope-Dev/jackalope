import { Checkbox, KeyValueList, SettingBody, SettingGroup } from '@jackalope/ui';
import type { TerminalCommand } from '../../lib/terminal-commands';
import { type Project, useProjectStore } from '../../stores/projectStore';

type Lifecycle = 'runOnWorktreeCreate' | 'stopWhenFinished';

const LIFECYCLE: { key: Lifecycle; title: string }[] = [
  { key: 'runOnWorktreeCreate', title: 'Run when a worktree is created' },
  { key: 'stopWhenFinished', title: 'Stop its terminal when the task finishes' },
];

/** Extra commands a task terminal offers as buttons, after preparation and verification. */
export function ProjectTerminalCommands({ project }: { project: Project }) {
  const saved = project.preferences?.terminalCommands;
  const commands: TerminalCommand[] = Array.isArray(saved)
    ? saved.filter((item) => typeof item?.name === 'string' && typeof item?.command === 'string')
    : [];
  const save = (next: TerminalCommand[]) =>
    useProjectStore.getState().updateProjectPreferences(project.id, { terminalCommands: next });
  const named = commands.filter((item) => item.name.trim() && item.command.trim());
  return (
    <SettingGroup
      title="Terminal commands"
      description="Buttons in a task's terminal, beside the preparation and verification commands. Each runs in the task's workspace with your OS permissions. Keep credentials out of commands. A command set to run when a worktree is created runs in each new task worktree after preparation, and a failure stops the task with its output. One set to stop its terminal, such as a dev server, stops the whole terminal that ran it, with everything else running there, when the task is merged or archived."
    >
      <SettingBody>
        <KeyValueList
          label="Terminal commands"
          keyLabel="Button name"
          valueLabel="Command"
          keyPlaceholder="Name"
          valuePlaceholder="pnpm test"
          addLabel="Add command"
          rows={commands.map((item) => ({ id: item.id, key: item.name, value: item.command }))}
          onRowsChange={(rows) =>
            save(
              rows.map((row) => {
                const previous = commands.find((item) => item.id === row.id);
                return {
                  ...previous,
                  id: row.id,
                  name: row.key.slice(0, 80),
                  command: row.value.slice(0, 4000),
                };
              }),
            )
          }
        />
      </SettingBody>
      {named.map((item) => (
        <SettingBody key={item.id}>
          <fieldset className="project-command-lifecycle">
            <legend className="project-command-lifecycle-legend">{item.name}</legend>
            {LIFECYCLE.map((option) => (
              <label key={option.key} className="ui-choice">
                <Checkbox
                  checked={item[option.key] === true}
                  onChange={(event) =>
                    save(
                      commands.map((other) =>
                        other.id === item.id
                          ? { ...other, [option.key]: event.target.checked || undefined }
                          : other,
                      ),
                    )
                  }
                />
                <span className="ui-choice-body">
                  <span className="ui-choice-title">{option.title}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </SettingBody>
      ))}
    </SettingGroup>
  );
}
