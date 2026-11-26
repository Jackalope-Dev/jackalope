import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineNotice,
  LoadingState,
  DropdownMenu as Menu,
  SearchField,
  SegmentedControl,
} from '@jackalope/ui';
import { FileUp, MoreHorizontal, Plus, Sparkles, Store } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { openSettings } from '../../lib/app-events';
import { isTauriEnvironment } from '../../lib/native/env';
import {
  deviceCoverage,
  exportSkill,
  filterCounts,
  keepSkillOutOfCommits,
  openSkill,
  type SkillCard,
  type SkillFilter,
  syncingDevices,
  syncSummary,
  visibleSkills,
} from '../../lib/skill-sync';
import { useProjectStore } from '../../stores/projectStore';
import { useSkillSyncStore } from '../../stores/skillSyncStore';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceToolbar } from '../ui/WorkspaceToolbar';
import { NewSkillDialog, type NewSkillMode } from './NewSkillDialog';
import { SkillDetailDialog } from './SkillDetailDialog';
import { SkillConstellation } from './SkillOrbit';
import { type SkillAction, SkillTile } from './SkillTile';
import './skills.css';
import { ConnectAccountButton } from '../account/RequiresAccount';

function since(at: string | null) {
  if (!at) return '';
  const minutes = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  return `Synced ${new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/**
 * Agent skills on this computer, personal and per project. Skills the person
 * chooses sync through their account to the same folder on their other
 * computers, and never into a repository.
 */
export function SkillsPage() {
  const { page, loaded, busy, error, refresh, configure, share, resolve, remove, clearError } =
    useSkillSyncStore();
  const projects = useProjectStore((state) => state.projects);
  const [filter, setFilter] = useState<SkillFilter>('all');
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [mode, setMode] = useState<NewSkillMode | null>(null);
  const [consent, setConsent] = useState<SkillCard | 'all' | null>(null);
  const [stopping, setStopping] = useState<SkillCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const [localError, setLocalError] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  // Dialogs here open without a Radix trigger, so they return focus themselves:
  // to the control that opened them, or to the menu button for a menu item.
  const opener = useRef<HTMLElement | null>(null);
  const remember = () => {
    const active = document.activeElement as HTMLElement | null;
    opener.current = active?.closest('[role="menu"]')
      ? document.querySelector<HTMLElement>('[aria-haspopup="menu"][data-state="open"]')
      : active;
  };
  const restoreFocus = (event: Event) => {
    if (opener.current?.isConnected) {
      event.preventDefault();
      opener.current.focus();
    }
  };
  useEffect(() => {
    void useSkillSyncStore.getState().refresh();
  }, []);
  const { sync } = page;
  const canSync = sync.available && sync.settingsSync;
  const counts = useMemo(() => filterCounts(page.skills), [page.skills]);
  const shown = useMemo(
    () => visibleSkills(page.skills, filter, query),
    [page.skills, filter, query],
  );
  const devices = useMemo(
    () => syncingDevices(page.skills, page.devices),
    [page.skills, page.devices],
  );
  const coverage = useMemo(() => deviceCoverage(page.skills, devices), [page.skills, devices]);
  const detail = page.skills.find((card) => card.id === detailId) ?? null;
  const local = async (work: () => Promise<unknown>) => {
    setLocalError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      setLocalError(describeError(cause));
    }
  };
  const onAction = (action: SkillAction, card: SkillCard) => {
    remember();
    switch (action) {
      case 'view':
      case 'resolve':
        setDetailId(card.id);
        return;
      case 'sync':
        if (sync.enabled) void share(card.id, true);
        else setConsent(card);
        return;
      case 'stop':
        setStopping(card);
        return;
      case 'open':
        void local(() => openSkill(card.id, 'file'));
        return;
      case 'reveal':
        void local(() => openSkill(card.id, 'folder'));
        return;
      case 'export':
        void local(async () => {
          const path = await exportSkill(card.id);
          if (path) setNotice(`Exported ${card.name} to ${path}.`);
        });
        return;
      case 'keep-out':
        void local(async () => {
          await keepSkillOutOfCommits(card.id);
          await useSkillSyncStore.getState().load();
        });
        return;
    }
  };
  const headline = !sync.enabled
    ? 'Keep your skills on every computer'
    : busy
      ? 'Syncing skills'
      : 'Skill sync is on';
  return (
    <WorkspacePage className="skills-page">
      <WorkspaceHeading
        title="Skills"
        action={
          <div className="skills-heading-actions">
            <Button
              onClick={() => {
                remember();
                setMode('template');
              }}
              disabled={!isTauriEnvironment()}
            >
              <Plus size={16} aria-hidden="true" />
              New skill
            </Button>
            <IconButton
              variant="outline"
              label="Import a skill file"
              disabled={!isTauriEnvironment()}
              onClick={() => {
                remember();
                setMode('import');
              }}
            >
              <FileUp size={16} />
            </IconButton>
          </div>
        }
      />
      {!isTauriEnvironment() && (
        <InlineNotice>Skills are available in the desktop app.</InlineNotice>
      )}
      <div className="workspace-sections">
        <section
          className="skill-hero"
          data-enabled={sync.enabled || undefined}
          aria-labelledby="skill-hero-title"
          aria-busy={busy}
        >
          <SkillConstellation
            devices={devices}
            holders={coverage}
            busy={busy}
            enabled={sync.enabled}
          />
          <div className="skill-hero-body">
            <h2 id="skill-hero-title">{headline}</h2>
            <p aria-live="polite">{syncSummary(page, busy)}</p>
            {!sync.enabled && canSync && (
              <p className="skill-hero-note">
                Synced skills go to the same folder on each computer where skill sync is on.
                Repository files are never changed or committed.
              </p>
            )}
            {sync.enabled && !busy && sync.lastSyncedAt && (
              <p className="skill-hero-note">{since(sync.lastSyncedAt)}</p>
            )}
            <div className="skill-hero-actions">
              {isTauriEnvironment() && !sync.available && !sync.reset && <ConnectAccountButton />}
              {sync.available && !sync.settingsSync && (
                <Button variant="outline" onClick={() => openSettings('Privacy')}>
                  Open privacy settings
                </Button>
              )}
              {canSync && !sync.enabled && (
                <Button
                  variant="outline"
                  onClick={() => {
                    remember();
                    setConsent('all');
                  }}
                >
                  Turn on skill sync
                </Button>
              )}
              {sync.enabled && (
                <>
                  <Button
                    variant="outline"
                    loading={busy}
                    loadingLabel="Syncing…"
                    onClick={() => void refresh()}
                  >
                    Sync now
                  </Button>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <IconButton variant="ghost" label="Skill sync options">
                        <MoreHorizontal size={16} />
                      </IconButton>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content className="workspace-menu" align="start" sideOffset={6}>
                        <Menu.Item
                          className="workspace-menu-item"
                          onSelect={() => void configure(false)}
                        >
                          Turn off on this computer
                        </Menu.Item>
                        <Menu.Separator className="menu-separator" />
                        <Menu.Item
                          className="workspace-menu-item"
                          data-tone="danger"
                          onSelect={() => {
                            remember();
                            setDeleting(true);
                          }}
                        >
                          Delete synced skills…
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                </>
              )}
            </div>
          </div>
        </section>
        {(error || localError) && (
          <InlineNotice
            tone="error"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearError();
                  setLocalError('');
                }}
              >
                Dismiss
              </Button>
            }
          >
            {error || localError}
          </InlineNotice>
        )}
        {notice && (
          <InlineNotice
            tone="success"
            action={
              <Button size="sm" variant="ghost" onClick={() => setNotice('')}>
                Dismiss
              </Button>
            }
          >
            {notice}
          </InlineNotice>
        )}
        <div className="workspace-stack">
          {page.skills.length > 0 && (
            <WorkspaceToolbar>
              <SegmentedControl<SkillFilter>
                label="Show"
                value={filter}
                onChange={setFilter}
                items={[
                  { id: 'all', label: 'All', count: counts.all },
                  { id: 'synced', label: 'Synced', count: counts.synced },
                  { id: 'local', label: 'Only here', count: counts.local },
                  ...(counts.attention
                    ? [{ id: 'attention' as const, label: 'Needs you', count: counts.attention }]
                    : []),
                ]}
              />
              <SearchField
                value={query}
                onValueChange={setQuery}
                placeholder="Search skills"
                aria-label="Search skills"
                containerClassName="skill-search"
              />
            </WorkspaceToolbar>
          )}
          {!loaded && isTauriEnvironment() ? (
            <LoadingState compact label="Looking for skills…" />
          ) : page.skills.length === 0 ? (
            isTauriEnvironment() && (
              <EmptyState
                icon={Sparkles}
                title="No skills on this computer yet"
                description="Jackalope looks in ~/.claude/skills, ~/.codex/skills, ~/.agents/skills and each project’s .claude/skills and .agents/skills."
                action={
                  <Button
                    onClick={() => {
                      remember();
                      setMode('template');
                    }}
                  >
                    New skill
                  </Button>
                }
              />
            )
          ) : shown.length === 0 ? (
            <p className="skill-empty-filter">No skills match.</p>
          ) : (
            <ul className="skill-grid">
              {shown.map((card) => (
                <li key={card.id} data-fresh={card.id === fresh || undefined}>
                  <SkillTile
                    card={card}
                    devices={devices}
                    syncAvailable={canSync && !busy}
                    onAction={onAction}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <section className="skill-browse" aria-labelledby="skill-browse-title">
          <span className="skill-browse-mark" aria-hidden="true">
            <Store size={20} />
          </span>
          <div>
            <h2 id="skill-browse-title">
              Browse and submit skills <Badge appearance="plain">Coming later</Badge>
            </h2>
            <p>
              A directory of shared skills isn’t available yet. To share one now, choose Export a
              copy from its menu and send the folder.
            </p>
          </div>
        </section>
      </div>
      <SkillDetailDialog
        card={detail}
        onClose={() => setDetailId(null)}
        onCloseAutoFocus={restoreFocus}
        onResolve={(card, keep) => resolve(card.syncedId ?? card.id, keep)}
        onKeepOut={async (card) => {
          await keepSkillOutOfCommits(card.id);
          await useSkillSyncStore.getState().load();
        }}
      />
      <NewSkillDialog
        mode={mode}
        projects={projects}
        onModeChange={setMode}
        onClose={() => setMode(null)}
        onCloseAutoFocus={restoreFocus}
        onCreated={(id) => {
          setMode(null);
          setFresh(id);
          setFilter('all');
          void useSkillSyncStore.getState().load();
        }}
      />
      <ConfirmDialog
        open={consent !== null}
        onOpenChange={(open) => !open && setConsent(null)}
        onCloseAutoFocus={restoreFocus}
        title={consent === 'all' ? 'Turn on skill sync?' : `Sync ${consent?.name ?? 'this skill'}?`}
        description="Jackalope uploads the text of the skills you choose to your Jackalope account and keeps them the same on each computer where skill sync is on. Skills already synced from your other computers are written to their folders here."
        label={consent === 'all' ? 'Turn on' : 'Sync skill'}
        busyLabel="Syncing…"
        variant="primary"
        onConfirm={async () => {
          if (consent === 'all') await configure(true);
          else if (consent) await share(consent.id, true);
          setConsent(null);
        }}
      />
      <ConfirmDialog
        open={stopping !== null}
        onOpenChange={(open) => !open && setStopping(null)}
        onCloseAutoFocus={restoreFocus}
        title={`Stop syncing ${stopping?.name ?? 'this skill'}?`}
        description="It is removed from your account. Every computer keeps its current copy, and later changes stay on each computer."
        label="Stop syncing"
        busyLabel="Stopping…"
        onConfirm={async () => {
          if (stopping) await share(stopping.syncedId ?? stopping.id, false);
          setStopping(null);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        onCloseAutoFocus={restoreFocus}
        title="Delete synced skills?"
        description="Removes every synced skill from your account and turns skill sync off on your other computers. Skill files on each computer stay where they are."
        label="Delete synced skills"
        busyLabel="Deleting…"
        variant="danger"
        onConfirm={async () => {
          await remove();
          setDeleting(false);
        }}
      />
    </WorkspacePage>
  );
}
