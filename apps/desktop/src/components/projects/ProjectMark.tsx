import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  FormField,
  InlineNotice,
  Input,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Atom,
  Bird,
  Blocks,
  Book,
  Bot,
  Brush,
  Camera,
  Cloud,
  Code,
  Coffee,
  Cpu,
  Database,
  Flame,
  Flower2,
  Gamepad2,
  Globe,
  Heart,
  Leaf,
  type LucideIcon,
  Music,
  Package,
  Rabbit,
  Rocket,
  Server,
  Shield,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { detectProjectWebsite, fetchProjectFavicon } from '../../lib/project-favicon';
import { type Project, useProjectStore } from '../../stores/projectStore';
import './project-mark.css';

/** Saved by key, so renaming a Lucide export never breaks a saved project icon. */
const PROJECT_ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  code: Code,
  terminal: Terminal,
  globe: Globe,
  smartphone: Smartphone,
  server: Server,
  database: Database,
  cloud: Cloud,
  cpu: Cpu,
  bot: Bot,
  atom: Atom,
  blocks: Blocks,
  package: Package,
  wrench: Wrench,
  shield: Shield,
  zap: Zap,
  flame: Flame,
  sparkles: Sparkles,
  star: Star,
  heart: Heart,
  book: Book,
  brush: Brush,
  camera: Camera,
  music: Music,
  gamepad: Gamepad2,
  shopping: ShoppingBag,
  coffee: Coffee,
  leaf: Leaf,
  flower: Flower2,
  bird: Bird,
  rabbit: Rabbit,
};

/** The `icon` key for a fetched site icon; versions without it show the initial instead. */
const WEBSITE_ICON = 'website';

const initial = (project: Pick<Project, 'name'>) =>
  project.name.trim().charAt(0).toUpperCase() || '?';

/** A project's chosen icon, or its initial when none is set (or a saved key is unknown). */
export function ProjectMark({
  project,
}: {
  project: Pick<Project, 'name' | 'icon' | 'iconImage'>;
}) {
  if (project.icon === WEBSITE_ICON && project.iconImage)
    return (
      <span className="project-tree-mark" data-image aria-hidden="true">
        <img src={project.iconImage} alt="" className="project-mark-image" draggable={false} />
      </span>
    );
  const Icon = project.icon ? PROJECT_ICONS[project.icon] : undefined;
  return (
    <span className="project-tree-mark" aria-hidden="true">
      {Icon ? <Icon size={13} strokeWidth={2.25} /> : initial(project)}
    </span>
  );
}

/** The host part of a typed or saved site address, for short copy. */
function siteHost(address: string | undefined) {
  const trimmed = address?.trim() ?? '';
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).host;
  } catch {
    return trimmed;
  }
}

/** Fetches a site's icon and applies it; the address starts as the one the project declares. */
function WebsiteIconField({ project, onDone }: { project: Project; onDone: () => void }) {
  const [address, setAddress] = useState(project.website ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The host a fetch in this dialog just applied, so the result says it worked. */
  const [fetchedFrom, setFetchedFrom] = useState<string | null>(null);
  useEffect(() => {
    if (project.website) return;
    let current = true;
    detectProjectWebsite(project.path)
      .then((found) => {
        if (current && found) setAddress((typed) => typed || found);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [project.path, project.website]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setFetchedFrom(null);
      const icon = await fetchProjectFavicon(address);
      useProjectStore.getState().updateProject(project.id, {
        icon: WEBSITE_ICON,
        iconImage: icon.dataUrl,
        website: address.trim(),
      });
      setFetchedFrom(siteHost(icon.siteUrl) || siteHost(address));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const usingSiteIcon = project.icon === WEBSITE_ICON && Boolean(project.iconImage);
  return (
    <form className="project-icon-website" onSubmit={submit}>
      <div className="project-icon-website-row">
        <FormField label="Website">
          <Input
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="example.com"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </FormField>
        <Button
          type="submit"
          variant="secondary"
          disabled={!address.trim()}
          loading={busy}
          loadingLabel="Fetching…"
        >
          Use site icon
        </Button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {usingSiteIcon && (
        <div className="project-icon-result" role="status">
          <span className="project-icon-result-preview">
            <img src={project.iconImage} alt="" draggable={false} />
          </span>
          <span className="project-icon-result-text">
            <strong>
              {fetchedFrom
                ? `Applied the icon from ${fetchedFrom}`
                : `Using the icon from ${siteHost(project.website) || 'the website'}`}
            </strong>
            <span className="project-icon-result-sample">
              <ProjectMark project={project} />
              <span>{project.name}</span>
            </span>
          </span>
          <Button type="button" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      )}
    </form>
  );
}

/** Picks the mark shown for a project in the sidebar; choosing applies it straight away. */
export function ProjectIconDialog({
  project,
  onOpenChange,
}: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
}) {
  const choose = (icon: string | undefined) => {
    if (project) useProjectStore.getState().updateProject(project.id, { icon });
    onOpenChange(false);
  };
  const hasSiteIcon = Boolean(project?.iconImage);
  return (
    <Dialog.Root open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="project-icon-dialog" aria-describedby={undefined}>
        <DialogHeader title={project ? `Icon for ${project.name}` : 'Project icon'} />
        <DialogCloseButton />
        {project && (
          <WebsiteIconField key={project.id} project={project} onDone={() => onOpenChange(false)} />
        )}
        {project && (
          <fieldset className="project-icon-grid" aria-label="Project icon">
            <button
              type="button"
              className="project-icon-option"
              aria-pressed={
                !project.icon ||
                (project.icon === WEBSITE_ICON ? !hasSiteIcon : !PROJECT_ICONS[project.icon])
              }
              aria-label="Initial"
              title="Initial"
              onClick={() => choose(undefined)}
            >
              <span className="project-icon-initial">{initial(project)}</span>
            </button>
            {hasSiteIcon && (
              <button
                type="button"
                className="project-icon-option"
                aria-pressed={project.icon === WEBSITE_ICON}
                aria-label="Site icon"
                title={project.website ? `Site icon from ${project.website}` : 'Site icon'}
                onClick={() => choose(WEBSITE_ICON)}
              >
                <img src={project.iconImage} alt="" className="project-icon-site" />
              </button>
            )}
            {Object.entries(PROJECT_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                className="project-icon-option"
                aria-pressed={project.icon === key}
                aria-label={key}
                title={key}
                onClick={() => choose(key)}
              >
                <Icon size={18} aria-hidden="true" />
              </button>
            ))}
          </fieldset>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
