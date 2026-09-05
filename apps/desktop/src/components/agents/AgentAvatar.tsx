import { motion, useReducedMotion } from 'motion/react';

export function AgentAvatar({
  provider,
  working,
  waiting,
}: {
  provider: string;
  working: boolean;
  waiting: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <span className="agent-avatar" data-provider={provider} aria-hidden="true">
      <motion.svg
        viewBox="0 0 80 80"
        fill="none"
        initial={false}
        animate={
          reduceMotion
            ? { y: 0, rotate: 0 }
            : {
                y: working ? [0, -3, 0] : 0,
                rotate: waiting ? [0, -7, 0] : 0,
              }
        }
        transition={{
          duration: 1.8,
          repeat: working || waiting ? Infinity : 0,
          repeatDelay: waiting ? 1 : 0,
        }}
      >
        {provider === 'claude' ? (
          <path
            d="m40 8 6 16 15-9-4 17 17 2-14 10 11 13-18-1-3 17-10-13-12 12-1-18-17 2 10-14L6 34l18-3-5-16 15 9Z"
            fill="currentColor"
          />
        ) : provider === 'grok' ? (
          <>
            <ellipse
              cx="40"
              cy="40"
              rx="33"
              ry="19"
              transform="rotate(-35 40 40)"
              stroke="currentColor"
              strokeWidth="3"
              opacity=".55"
            />
            <circle cx="40" cy="40" r="23" fill="currentColor" />
            <path
              d="m57 17 7-7m-3 12 8-3"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <rect x="12" y="16" width="56" height="49" rx="18" fill="currentColor" />
            <path d="M25 13V9m30 4V9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </>
        )}
        <g
          className="agent-avatar-face"
          stroke="var(--color-bg)"
          strokeWidth="3.5"
          strokeLinecap="round"
        >
          <path d={waiting ? 'M29 35h5m12 0h5' : 'M31 33v5m18-5v5'} />
          <path d="M33 47q7 6 14 0" />
        </g>
      </motion.svg>
    </span>
  );
}
