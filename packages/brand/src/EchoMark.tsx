import type { CSSProperties } from 'react';
import { characterPaths } from './character';
import './echo.css';

const head = [
  characterPaths.farEar,
  characterPaths.nearEar,
  characterPaths.antler,
  characterPaths.head,
].join(' ');

export function EchoWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-echo-wordmark ${className}`} aria-hidden="true">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((echo) => (
        <span
          key={echo}
          className="brand-echo-wordmark-line"
          style={{ '--echo': echo } as CSSProperties}
        >
          jackalope
        </span>
      ))}
      <span className="brand-echo-wordmark-face">jackalope</span>
    </span>
  );
}

export function EchoMark({
  animated = true,
  className = '',
}: {
  animated?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`brand-echo ${className}`}
      data-animated={animated}
      viewBox="80 25 440 430"
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(-58 24) scale(3.3)">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((echo) => (
          <path
            key={echo}
            d={head}
            className="brand-echo-line"
            style={{ '--echo': echo } as CSSProperties}
          />
        ))}
        <path d={head} fill="currentColor" />
      </g>
    </svg>
  );
}
