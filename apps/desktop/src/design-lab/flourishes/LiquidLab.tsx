import {
  Liquid,
  LiquidActions,
  LiquidItem,
  SegmentedControl,
  SegmentedNav,
  Switch,
  Tabs,
} from '@jackalope/ui';
import { Bot, Download, Plus, Sparkles, UserPlus } from 'lucide-react';
import { useState } from 'react';

const FILTERS = [
  { id: 'all', label: 'All', count: 12 },
  { id: 'working', label: 'Working', count: 3 },
  { id: 'review', label: 'Review', count: 2 },
  { id: 'finished', label: 'Finished' },
] as const;
const VIEWS = [
  { id: 'changes', label: 'Changes' },
  { id: 'checks', label: 'Checks' },
  { id: 'merge', label: 'Merge' },
] as const;

/** Fixture only: the actions record what was chosen and never create anything. */
export function LiquidLab() {
  const [chosen, setChosen] = useState('Nothing chosen yet');
  const [disabled, setDisabled] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('changes');
  const [split, setSplit] = useState(false);
  const choose = (label: string) => () => setChosen(`Chose “${label}”`);
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-6 min-h-60">
        <div className="grid gap-3">
          <p className="text-sm text-[var(--color-text-secondary)]" role="status">
            {chosen}
          </p>
          <span className="flex items-center gap-2 text-sm">
            <Switch checked={disabled} onCheckedChange={setDisabled} label="Unavailable" />
            Unavailable
          </span>
        </div>
        <LiquidActions
          label="New bot"
          icon={<Plus size={16} aria-hidden="true" />}
          disabled={disabled}
          actions={[
            {
              id: 'blank',
              label: 'Blank bot',
              icon: <Bot size={16} aria-hidden="true" />,
              onSelect: choose('Blank bot'),
            },
            {
              id: 'template',
              label: 'From a template…',
              icon: <Sparkles size={16} aria-hidden="true" />,
              onSelect: choose('From a template'),
            },
            {
              id: 'import',
              label: 'Import bots…',
              icon: <Download size={16} aria-hidden="true" />,
              onSelect: choose('Import bots'),
            },
            {
              id: 'existing',
              label: 'Add an existing bot…',
              icon: <UserPlus size={16} aria-hidden="true" />,
              disabled: true,
              onSelect: choose('Add an existing bot'),
            },
          ]}
        />
      </div>
      <div className="grid gap-4 justify-items-start">
        <SegmentedControl label="Filter work" items={FILTERS} value={filter} onChange={setFilter} />
        <SegmentedNav label="Review views" items={VIEWS} value={view} onChange={setView} />
        <Tabs.Root defaultValue="activity">
          <Tabs.List appearance="segmented" aria-label="Task panels">
            <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
            <Tabs.Trigger value="result">Result</Tabs.Trigger>
            <Tabs.Trigger value="files">Changed files</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div className="grid gap-3 justify-items-start">
        <span className="flex items-center gap-2 text-sm">
          <Switch checked={split} onCheckedChange={setSplit} label="Split the pieces" />
          Split the pieces
        </span>
        <Liquid className="flex gap-2 p-2" shadow="0 2px 6px rgb(0 0 0 / 0.12)">
          {['Plan', 'Build', 'Check'].map((label, index) => (
            <LiquidItem
              key={label}
              x={split ? (index - 1) * 24 : 0}
              transition="bouncy"
              delay={index * 40}
            >
              <span className="inline-flex h-9 items-center rounded-full px-4 text-sm">
                {label}
              </span>
            </LiquidItem>
          ))}
        </Liquid>
      </div>
    </div>
  );
}
