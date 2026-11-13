import { KeyValueList, SettingBody, SettingGroup } from '@jackalope/ui';
import type { TerminalCommand } from '../../lib/terminal-commands';
import { type Project, useProjectStore } from '../../stores/projectStore';

/** Extra commands a task terminal offers as buttons, after preparation and verification. */
export function ProjectTerminalCommands({ project }: { project: Project }) {
  const saved = project.preferences?.terminalCommands;
  const commands: TerminalCommand[] = Array.isArray(saved)
    ? saved.filter((item) => typeof item?.name === 'string' && typeof item?.command === 'string')
    : [];
  return (
    <SettingGroup
      title="Terminal commands"
      description="Buttons in a task's terminal, beside the preparation and verification commands. Each runs only when you choose it, in the task's workspace, with your OS permissions. Keep credentials out of commands."
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
            useProjectStore.getState().updateProjectPreferences(project.id, {
              terminalCommands: rows.map((row) => ({
                id: row.id,
                name: row.key.slice(0, 80),
                command: row.value.slice(0, 4000),
              })),
            })
          }
        />
      </SettingBody>
    </SettingGroup>
  );
}
