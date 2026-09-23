import { characterPaths } from '@jackalope/brand/character';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="38 4 105 117" fill="currentColor" aria-hidden="true" className={className}>
      <path d={characterPaths.farEar} />
      <path d={characterPaths.nearEar} />
      <path d={characterPaths.antler} />
      <path d={characterPaths.head} />
    </svg>
  );
}
