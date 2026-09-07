import { characterPaths as paths } from '@jackalope/brand/character';

export function BrandEmblem({ className = '', href }: { className?: string; href?: string }) {
  const artwork = (
    <svg viewBox="38 3 105 117" fill="currentColor" aria-hidden="true">
      <g className="emblem-ears">
        <path d={paths.farEar} />
        <path d={paths.nearEar} />
      </g>
      <path d={paths.antler} />
      <path d={paths.head} />
    </svg>
  );
  return href ? (
    <a
      href={href}
      className={`brand-emblem emblem-link ${className}`}
      aria-label="Explore the Jackalope workflow"
    >
      {artwork}
    </a>
  ) : (
    <div className={`brand-emblem ${className}`}>{artwork}</div>
  );
}
