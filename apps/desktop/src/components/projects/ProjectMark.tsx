import { DialogCloseButton, DialogContent, DialogHeader } from '@jackalope/ui';
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
import { type Project, useProjectStore } from '../../stores/projectStore';

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

const initial = (project: Pick<Project, 'name'>) =>
  project.name.trim().charAt(0).toUpperCase() || '?';

/** A project's chosen icon, or its initial when none is set (or a saved key is unknown). */
export function ProjectMark({ project }: { project: Pick<Project, 'name' | 'icon'> }) {
  const Icon = project.icon ? PROJECT_ICONS[project.icon] : undefined;
  return (
    <span className="project-tree-mark" aria-hidden="true">
      {Icon ? <Icon size={13} strokeWidth={2.25} /> : initial(project)}
    </span>
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
  return (
    <Dialog.Root open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="project-icon-dialog" aria-describedby={undefined}>
        <DialogHeader title={project ? `Icon for ${project.name}` : 'Project icon'} />
        <DialogCloseButton />
        {project && (
          <fieldset className="project-icon-grid" aria-label="Project icon">
            <button
              type="button"
              className="project-icon-option"
              aria-pressed={!project.icon || !PROJECT_ICONS[project.icon]}
              aria-label="Initial"
              title="Initial"
              onClick={() => choose(undefined)}
            >
              <span className="project-icon-initial">{initial(project)}</span>
            </button>
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
