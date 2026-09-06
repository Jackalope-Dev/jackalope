import { characterPaths as paths } from '@jackalope/brand/character';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useState } from 'react';
import { type MascotMood, useMascotStore } from '../../stores/mascotStore';

interface JackalopeMascotProps {
  size?: 'sm' | 'md' | 'lg';
  showBubble?: boolean;
  className?: string;
  overrideMood?: MascotMood;
  bubbleAlign?: 'center' | 'end';
  bubbleSide?: 'above' | 'below';
  reduceMotion?: boolean;
}

const mascotMotion = {
  idle: {
    y: 0,
    scaleY: 1,
    rotate: 0,
    opacity: 1,
    transition: { duration: 0.4 },
  },
  thinking: {
    y: 0,
    scaleY: 1,
    rotate: [0, -5, -5, 0],
    opacity: 1,
    transition: { duration: 3.5, repeat: Infinity, repeatDelay: 1.5 },
  },
  working: {
    y: [0, -1.5, 0],
    scaleY: 1,
    rotate: 0,
    opacity: 1,
    transition: { duration: 1.6, repeat: Infinity },
  },
  success: {
    y: [0, -9, 0, -3, 0],
    scaleY: [1, 1.04, 0.97, 1.02, 1],
    rotate: [0, -3, 0],
    opacity: 1,
    transition: { duration: 0.9 },
  },
  sleep: {
    y: 1,
    scaleY: [0.97, 0.985, 0.97],
    rotate: 0,
    opacity: 0.7,
    transition: { duration: 5, repeat: Infinity },
  },
};

export function JackalopeMascot({
  size = 'md',
  showBubble = true,
  className = '',
  overrideMood,
  bubbleAlign = 'center',
  bubbleSide = 'above',
  reduceMotion: forceReducedMotion = false,
}: JackalopeMascotProps) {
  const { mood, message, pet } = useMascotStore();
  const faceMask = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const currentMood = overrideMood ?? mood;
  const systemReducedMotion = useReducedMotion();
  const reduceMotion = forceReducedMotion || systemReducedMotion;
  const dim = size === 'sm' ? 40 : size === 'md' ? 88 : 152;
  const resting = currentMood === 'sleep';
  const attentive = (hovered || focused) && !resting;
  const delighted = currentMood === 'success';
  const mouth = delighted
    ? 'M117 88 Q122 94 128 88'
    : attentive
      ? 'M118 89 Q123 93 127 88'
      : 'M120 90 Q123 91 126 89';
  const staticPose = { y: 0, scaleY: 1, rotate: 0, opacity: resting ? 0.7 : 1 };

  return (
    <div className={`relative flex items-center select-none ${className}`}>
      <AnimatePresence>
        {showBubble && message && (
          <motion.div
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`absolute ${bubbleSide === 'above' ? 'bottom-full mb-3' : 'top-full mt-3'} z-30 pointer-events-none w-max max-w-[min(17rem,calc(100vw-2rem))] bg-[var(--color-surface-elevated)] px-3 py-2 rounded-xl shadow-lg text-xs leading-relaxed text-[var(--color-text-primary)] ${bubbleAlign === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
          >
            {message}
            <span
              className={`absolute ${bubbleSide === 'above' ? '-bottom-1' : '-top-1'} w-2 h-2 bg-[var(--color-surface-elevated)] rotate-45 ${bubbleAlign === 'end' ? 'right-4' : 'left-1/2 -translate-x-1/2'}`}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.button
        type="button"
        onClick={pet}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={`Pet Jackalope, currently ${currentMood}`}
        data-mood={currentMood}
        title="Pet Jackalope"
        whileHover={reduceMotion ? undefined : { scale: 1.04 }}
        whileTap={reduceMotion ? undefined : { scale: 0.97 }}
        className="relative cursor-pointer bg-transparent border-0 p-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        style={{ width: dim, height: dim }}
      >
        <svg
          viewBox="25 -8 128 128"
          fill="var(--color-text-primary)"
          aria-hidden="true"
          className="w-full h-full overflow-visible"
        >
          <defs>
            <mask id={faceMask} maskUnits="userSpaceOnUse" x="25" y="-8" width="128" height="128">
              <rect x="25" y="-8" width="128" height="128" fill="white" />
              <motion.g
                animate={{ x: attentive ? 0.8 : 0, y: attentive ? -0.5 : 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
              >
                {resting || delighted ? (
                  <path
                    d={resting ? 'M100 73 Q103 76 106 73' : 'M100 73 Q103 69 106 73'}
                    fill="none"
                    stroke="black"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                ) : (
                  <motion.ellipse
                    cx="103"
                    cy="73"
                    rx="2.5"
                    ry="3.3"
                    fill="black"
                    animate={{ scaleY: attentive && !reduceMotion ? [1, 0.12, 1] : 1 }}
                    transition={{ duration: reduceMotion ? 0 : 0.24, times: [0, 0.45, 1] }}
                    style={{ transformOrigin: '103px 73px' }}
                  />
                )}
              </motion.g>
              <motion.path
                d={mouth}
                initial={{ d: mouth, opacity: resting ? 0 : 1 }}
                animate={{ d: mouth, opacity: resting ? 0 : 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                fill="none"
                stroke="black"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </mask>
          </defs>
          <motion.g
            variants={mascotMotion}
            animate={reduceMotion ? staticPose : currentMood}
            style={{ transformOrigin: '89px 100px' }}
          >
            <path d={paths.antler} />
            <motion.path
              d={paths.farEar}
              animate={{ rotate: resting ? 10 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.5 }}
              style={{ transformOrigin: '89px 62px' }}
            />
            <motion.path
              d={paths.nearEar}
              animate={{
                rotate: resting
                  ? -10
                  : !reduceMotion && currentMood === 'working'
                    ? [0, -4, 0]
                    : currentMood === 'thinking'
                      ? -5
                      : 0,
              }}
              transition={
                !reduceMotion && currentMood === 'working'
                  ? { duration: 2.8, repeat: Infinity, repeatDelay: 1 }
                  : { duration: reduceMotion ? 0 : 0.5 }
              }
              style={{ transformOrigin: '83px 63px' }}
            />
            <path d={paths.head} mask={`url(#${faceMask})`} />
          </motion.g>
        </svg>
      </motion.button>
    </div>
  );
}
