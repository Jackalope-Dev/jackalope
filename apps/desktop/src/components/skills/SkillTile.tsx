import { Badge, Button, IconButton, DropdownMenu as Menu } from '@jackalope/ui';
import {
  AlertTriangle,
  FileText,
  FolderOpen,
  FolderTree,
  GitBranchPlus,
  MoreHorizontal,
  Share,
  Unlink,
} from 'lucide-react';
import { fileManagerName } from '../../lib/native/env';
import {
  blockedReason,
  ROOT_LABELS,
  type SkillCard,
  type SkillDevice,
  STATUS_LABELS,
} from '../../lib/skill-sync';
import { ProviderMark } from '../agents/ProviderMark';
import { SkillRing } from './SkillOrbit';

export type SkillAction =
  | 'view'
  | 'sync'
  | 'stop'
  | 'resolve'
  | 'open'
  | 'reveal'
  | 'export'
  | 'keep-out';

function AgentMark({ root }: { root: SkillCard['root'] }) {
  if (root === 'agents') return <FolderTree size={18} aria-hidden="true" />;
  return <ProviderMark provider={root} size={18} />;
}

/** The one-line detail under a skill's status: why it can't sync, an error or where it lives. */
function detail(card: SkillCard) {
  if (card.error) return { text: card.error, warn: true };
  if (card.blocked) return { text: blockedReason(card.blocked), warn: false };
  if (card.tracking === 'untracked')
    return { text: 'Not committed or ignored, so a commit could include it.', warn: true };
  if (card.status === 'elsewhere')
    return {
      text: card.path
        ? 'Writes here on the next sync.'
        : card.scope === 'project'
          ? 'Belongs to a project that isn’t on this computer.'
          : 'Not on this computer.',
      warn: false,
    };
  return { text: card.path ?? '', warn: false };
}

export function SkillTile({
  card,
  devices,
  syncAvailable,
  onAction,
}: {
  card: SkillCard;
  devices: SkillDevice[];
  /** Signed in with settings sync on, so Sync can start. */
  syncAvailable: boolean;
  onAction: (action: SkillAction, card: SkillCard) => void;
}) {
  const status = STATUS_LABELS[card.status];
  const local = card.status !== 'elsewhere';
  const line = detail(card);
  const where = card.scope === 'personal' ? 'Personal' : (card.project?.name ?? 'Project');
  const titleId = `skill-${card.id}-title`;
  return (
    <article className="skill-tile" data-status={card.status} aria-labelledby={titleId}>
      <header className="skill-tile-head">
        <span className="skill-tile-mark" title={ROOT_LABELS[card.root]}>
          <AgentMark root={card.root} />
          <span className="ui-sr-only">{ROOT_LABELS[card.root]}</span>
        </span>
        <h3 className="skill-tile-title" id={titleId}>
          <button type="button" className="skill-tile-open" onClick={() => onAction('view', card)}>
            {card.name}
          </button>
        </h3>
        <SkillRing devices={devices} holders={card.holders} synced={card.syncedId !== null} />
      </header>
      <p className="skill-tile-description">{card.description || 'No description.'}</p>
      <div className="skill-tile-meta">
        <Badge
          variant={status.tone}
          icon={card.status === 'conflict' || card.error ? AlertTriangle : undefined}
        >
          {status.label}
        </Badge>
        <span className="skill-tile-where">{where}</span>
      </div>
      <p className="skill-tile-detail" data-warn={line.warn || undefined} title={line.text}>
        {line.text}
      </p>
      <footer className="skill-tile-actions">
        {card.status === 'conflict' ? (
          <Button size="sm" onClick={() => onAction('resolve', card)}>
            Choose a copy
          </Button>
        ) : card.syncedId === null && card.status === 'local' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!syncAvailable}
            onClick={() => onAction('sync', card)}
          >
            Sync
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onAction('view', card)}>
            View
          </Button>
        )}
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton variant="ghost" label={`More actions for ${card.name}`}>
              <MoreHorizontal size={16} />
            </IconButton>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="workspace-menu" align="end" sideOffset={6}>
              <Menu.Item className="workspace-menu-item" onSelect={() => onAction('view', card)}>
                <FileText size={16} aria-hidden="true" />
                View content
              </Menu.Item>
              {local && (
                <>
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => onAction('open', card)}
                  >
                    <FileText size={16} aria-hidden="true" />
                    Open SKILL.md
                  </Menu.Item>
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => onAction('reveal', card)}
                  >
                    <FolderOpen size={16} aria-hidden="true" />
                    Show in {fileManagerName()}
                  </Menu.Item>
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => onAction('export', card)}
                  >
                    <Share size={16} aria-hidden="true" />
                    Export a copy…
                  </Menu.Item>
                </>
              )}
              {card.scope === 'project' && card.tracking === 'untracked' && (
                <Menu.Item
                  className="workspace-menu-item"
                  onSelect={() => onAction('keep-out', card)}
                >
                  <GitBranchPlus size={16} aria-hidden="true" />
                  Keep out of commits
                </Menu.Item>
              )}
              {card.syncedId !== null && (
                <>
                  <Menu.Separator className="menu-separator" />
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => onAction('stop', card)}
                  >
                    <Unlink size={16} aria-hidden="true" />
                    Stop syncing
                  </Menu.Item>
                </>
              )}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </footer>
    </article>
  );
}
