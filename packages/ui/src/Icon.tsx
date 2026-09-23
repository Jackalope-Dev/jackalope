import {
  ArrowUpRight,
  LoaderCircle,
  type LucideIcon,
  type LucideProps,
  Mail,
  MessageSquare,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { cn } from './utils';
import './icon.css';

export type IconSize = 16 | 20 | 24;
export type IconProps = Omit<LucideProps, 'size'> & { icon: LucideIcon; size?: IconSize };
export function Icon({ icon: Glyph, size = 16, className, ...props }: IconProps) {
  const labelled = props['aria-label'] || props['aria-labelledby'];
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      focusable="false"
      {...props}
      className={cn('ui-icon', className)}
    />
  );
}
type ActionIconProps = Omit<IconProps, 'icon'>;
export const RefreshIcon = (props: ActionIconProps) => <Icon icon={RotateCw} {...props} />;
export const FeedbackIcon = (props: ActionIconProps) => <Icon icon={MessageSquare} {...props} />;
export const MailIcon = (props: ActionIconProps) => <Icon icon={Mail} {...props} />;
export const SearchIcon = (props: ActionIconProps) => <Icon icon={Search} {...props} />;
export const CloseIcon = (props: ActionIconProps) => <Icon icon={X} {...props} />;
export const ExternalLinkIcon = (props: ActionIconProps) => <Icon icon={ArrowUpRight} {...props} />;
export const LoadingIcon = (props: ActionIconProps) => (
  <Icon icon={LoaderCircle} {...props} className={cn('ui-icon-loading', props.className)} />
);
