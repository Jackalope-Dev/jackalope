import { useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useMascotStore, type MascotMood } from '../../stores/mascotStore';
import { characterPaths as paths } from './character-paths';

interface JackalopeMascotProps {
  size?: 'sm' | 'md' | 'lg';
  showBubble?: boolean;
  className?: string;
  overrideMood?: MascotMood;
  bubbleAlign?: 'center' | 'end';
  bubbleSide?: 'above' | 'below';
  reduceMotion?: boolean;
}

const bodyMotion = {
  idle: { y: [0, -0.8, 0], scaleY: [1, 1.012, 1], rotate: 0, opacity: 1,
    transition: { duration: 4, repeat: Infinity } },
  thinking: { y: 0, scaleY: 1, rotate: [0, -3, -3, 0], opacity: 1,
    transition: { duration: 3.5, repeat: Infinity, repeatDelay: 1.5 } },
  working: { y: [0, -2, 0], scaleY: [1, 1.02, 1], rotate: 0, opacity: 1,
    transition: { duration: 1.6, repeat: Infinity } },
  success: { y: [0, -9, 0, -3, 0], scaleY: [1, 1.04, 0.97, 1.02, 1], rotate: [0, -3, 0], opacity: 1,
    transition: { duration: 0.9 } },
  sleep: { y: 1, scaleY: [0.97, 0.985, 0.97], rotate: 0, opacity: 0.7,
    transition: { duration: 5, repeat: Infinity } },
};

export function JackalopeMascot({ size = 'md', showBubble = true, className = '', overrideMood, bubbleAlign = 'center', bubbleSide = 'above', reduceMotion: forceReducedMotion = false }: JackalopeMascotProps) {
  const { mood, message, pet } = useMascotStore();
  const currentMood = overrideMood ?? mood;
  const systemReducedMotion = useReducedMotion();
  const reduceMotion = forceReducedMotion || systemReducedMotion;
  const gradientId = useId();
  const dim = size === 'sm' ? 40 : size === 'md' ? 88 : 152;
  const resting = currentMood === 'sleep';
  const staticPose = { y: 0, scaleY: 1, rotate: 0, opacity: resting ? 0.7 : 1 };

  return (
    <div className={`relative flex items-center select-none ${className}`}>
      <AnimatePresence>
        {showBubble && message && (
          <motion.div
            role="status"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`absolute ${bubbleSide === 'above' ? 'bottom-full mb-3' : 'top-full mt-3'} z-30 pointer-events-none w-max max-w-[min(17rem,calc(100vw-2rem))] bg-[var(--color-surface-elevated)] px-3 py-2 rounded-xl shadow-lg text-xs leading-relaxed text-[var(--color-text-primary)] ${bubbleAlign === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
          >
            {message}
            <span className={`absolute ${bubbleSide === 'above' ? '-bottom-1' : '-top-1'} w-2 h-2 bg-[var(--color-surface-elevated)] rotate-45 ${bubbleAlign === 'end' ? 'right-4' : 'left-1/2 -translate-x-1/2'}`} />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.button
        type="button" onClick={pet}
        aria-label={`Pet Jackalope, currently ${currentMood}`} data-mood={currentMood}
        title="Pet Jackalope"
        whileHover={reduceMotion ? undefined : { scale: 1.04 }}
        whileTap={reduceMotion ? undefined : { scale: 0.97 }}
        className="relative cursor-pointer bg-transparent border-0 p-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        style={{ width: dim, height: dim }}
      >
        <svg viewBox="0 0 160 160" fill="none" aria-hidden="true" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="55" y1="30" x2="114" y2="149" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--color-text-primary)" />
              <stop offset="1" stopColor="var(--color-accent)" />
            </linearGradient>
          </defs>
          <ellipse cx="78" cy="152" rx="40" ry="3" fill="var(--color-accent-subtle)" />
          <motion.g variants={bodyMotion} animate={reduceMotion ? staticPose : currentMood} style={{ originX: 0.5, originY: 0.9375, transformBox: 'view-box' }}>
            <path d={paths.tail} fill="var(--color-accent-hover)" />
            <path d={paths.body} fill={`url(#${gradientId})`} />
            <path d={paths.haunch} fill="var(--color-accent)" opacity="0.38" />
            <motion.g animate={{ rotate: resting ? 7 : currentMood === 'thinking' ? -6 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.6 }} style={{ originX: 0.55625, originY: 0.61875, transformBox: 'view-box' }}>
              <path d={paths.antler} fill="var(--color-accent-hover)" />
              <motion.path d={paths.farEar} fill="var(--color-accent-hover)"
                animate={{ rotate: resting ? 12 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.6 }}
                style={{ originX: 0.55625, originY: 0.3875, transformBox: 'view-box' }} />
              <motion.g
                animate={{ rotate: reduceMotion ? (resting ? -12 : 0) : resting ? -12 : currentMood === 'working' ? [0, -5, 0] : [0, -3, 0, 0] }}
                transition={reduceMotion || resting ? { duration: 0 } : { duration: 2.8, repeat: Infinity, repeatDelay: 2 }}
                style={{ originX: 0.51875, originY: 0.39375, transformBox: 'view-box' }}>
                <path d={paths.nearEar} fill={`url(#${gradientId})`} />
                <path d={paths.earInset} fill="var(--color-accent-hover)" opacity="0.45" />
              </motion.g>
              <path d={paths.head} fill={`url(#${gradientId})`} />
              {resting || currentMood === 'success' ? (
                <path d={resting ? 'M108 77 Q112 81 116 77' : 'M108 79 Q112 74 116 79'} stroke="var(--color-surface-sunken)" strokeWidth="2.5" strokeLinecap="round" />
              ) : (
                <motion.ellipse cx="112" cy="77" rx="2.7" ry="3" fill="var(--color-surface-sunken)"
                  animate={reduceMotion ? { scaleY: 1 } : { scaleY: [1, 1, 0.1, 1, 1] }}
                  transition={{ duration: 5.2, times: [0, 0.88, 0.9, 0.93, 1], repeat: Infinity }}
                  style={{ originX: 0.7, originY: 0.48125, transformBox: 'view-box' }} />
              )}
            </motion.g>
          </motion.g>
        </svg>
      </motion.button>
    </div>
  );
}
