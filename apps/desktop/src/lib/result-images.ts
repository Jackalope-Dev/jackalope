import { createElement } from 'react';
import { safeResultLink } from './task-workflow.ts';

export function ResultImage({
  src,
  alt,
  onOpenLink,
}: {
  src?: string;
  alt?: string;
  onOpenLink: (url: string) => void;
}) {
  const url = safeResultLink(src);
  const label = alt ? `Open image: ${alt}` : 'Open image';
  return url
    ? createElement(
        'button',
        { type: 'button', className: 'task-link result-link', onClick: () => onOpenLink(url) },
        label,
      )
    : createElement('span', {}, alt || 'Image unavailable');
}
