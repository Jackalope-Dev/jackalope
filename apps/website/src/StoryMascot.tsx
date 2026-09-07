import { characterPaths as paths } from '@jackalope/brand/character';
import { motion, useReducedMotion } from 'motion/react';
import { useId, useState } from 'react';

export function StoryMascot({
  className = '',
  interactive = false,
  mood = 'idle',
}: {
  className?: string;
  interactive?: boolean;
  mood?: 'idle' | 'thinking' | 'working' | 'success';
}) {
  const mask = useId();
  const reduced = useReducedMotion();
  const [pet, setPet] = useState(0);
  const [attentive, setAttentive] = useState(false);
  const artwork = (
    <motion.svg
      viewBox="18 0 130 158"
      aria-hidden="true"
      initial={false}
      animate={
        reduced
          ? {}
          : {
              y: pet ? [0, -12, 0, -4, 0] : 0,
              rotate: mood === 'thinking' ? -7 : pet ? [0, -5, 3, 0] : 0,
            }
      }
      key={pet}
      transition={{ duration: 0.7 }}
    >
      <defs>
        <mask id={mask}>
          <rect width="160" height="160" fill="white" />
          <ellipse
            className="character-eye"
            cx="110"
            cy="78"
            rx="2.5"
            ry={attentive || mood === 'success' ? 1 : 2.8}
            fill="black"
          />
          <path
            d={
              attentive || mood === 'success' ? 'M117 87 Q123 95 129 87' : 'M120 90 Q124 92 127 89'
            }
            stroke="black"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </mask>
      </defs>
      <g fill="currentColor">
        <path d={paths.tail} />
        <path d={paths.body} />
        <g className="character-ears">
          <path d={paths.farEar} />
          <path d={paths.nearEar} />
        </g>
        <path d={paths.antler} />
        <path d={paths.head} mask={`url(#${mask})`} />
      </g>
    </motion.svg>
  );
  if (!interactive)
    return (
      <div className={`story-character ${className}`} data-mood={mood}>
        {artwork}
      </div>
    );
  return (
    <button
      type="button"
      className={`story-character character-button ${className}`}
      aria-label="Say hello to Jackalope"
      onClick={() => setPet(pet + 1)}
      onPointerEnter={() => setAttentive(true)}
      onPointerLeave={() => setAttentive(false)}
      onFocus={() => setAttentive(true)}
      onBlur={() => setAttentive(false)}
    >
      {artwork}
      <span className="character-hello" aria-hidden="true">
        {pet ? 'Right. Let’s make something.' : 'Oh, hello there.'}
      </span>
    </button>
  );
}
