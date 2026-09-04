import { motion, AnimatePresence } from 'motion/react';
import { useMascotStore, MascotMood } from '../../stores/mascotStore';

interface JackalopeMascotProps {
  size?: 'sm' | 'md' | 'lg';
  showBubble?: boolean;
  className?: string;
  overrideMood?: MascotMood;
}

export function JackalopeMascot({
  size = 'md',
  showBubble = true,
  className = '',
  overrideMood,
}: JackalopeMascotProps) {
  const { mood: storeMood, message, pet } = useMascotStore();
  const currentMood = overrideMood || storeMood;

  // Pixel dimensions based on size
  const dim = size === 'sm' ? 42 : size === 'md' ? 68 : 110;

  // Determine animation variants based on mood
  const bodyVariants = {
    idle: {
      y: [0, -2, 0],
      scale: [1, 1.015, 1],
      transition: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' as const },
    },
    thinking: {
      rotate: [-3, 3, -3],
      y: [0, -4, 0],
      transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const },
    },
    working: {
      y: [0, -3, 0, -2, 0],
      scale: [1, 1.03, 0.99, 1.02, 1],
      transition: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const },
    },
    success: {
      y: [0, -14, 0, -6, 0],
      scale: [1, 1.1, 0.96, 1.05, 1],
      rotate: [0, -8, 8, -4, 0],
      transition: { duration: 0.8, repeat: 1, ease: 'easeOut' as const },
    },
    sleep: {
      opacity: 0.7,
      scale: [1, 0.98, 1],
      transition: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' as const },
    },
  };

  const earVariants = {
    idle: {
      rotate: [0, -3, 0, 4, 0],
      transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' as const },
    },
    thinking: {
      rotate: [-8, 6, -8],
      transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' as const },
    },
    working: {
      rotate: [2, -4, 3, -2, 2],
      transition: { duration: 0.6, repeat: Infinity },
    },
    success: {
      rotate: [0, -12, 12, 0],
      transition: { duration: 0.5, repeat: 2 },
    },
    sleep: {
      rotate: -12,
      transition: { duration: 1 },
    },
  };

  return (
    <div className={`relative flex items-center select-none ${className}`}>
      {/* Speech Bubble */}
      <AnimatePresence>
        {showBubble && message && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            className="absolute -top-12 left-1/2 -translate-x-1/2 z-30 pointer-events-none whitespace-nowrap bg-[var(--color-surface-elevated)] border border-[var(--color-border)] px-3 py-1.5 rounded-xl shadow-lg text-xs font-medium text-[var(--color-text-primary)]"
          >
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
              <span>{message}</span>
            </div>
            {/* Tiny pointer triangle */}
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-[var(--color-surface-elevated)] border-r border-b border-[var(--color-border)] rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interactive Mascot Canvas */}
      <motion.button
        type="button"
        onClick={pet}
        title="Jackalope (Click to pet)"
        variants={bodyVariants}
        animate={currentMood}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        className="relative cursor-pointer bg-transparent border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded-full"
        style={{ width: dim, height: dim }}
      >
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-md overflow-visible"
        >
          {/* Subtle Ambient Glow behind mascot */}
          <circle
            cx="50"
            cy="56"
            r="38"
            fill="var(--color-accent)"
            fillOpacity={currentMood === 'working' ? 0.22 : 0.12}
            className="transition-all duration-300"
          />

          {/* Antlers Group */}
          <motion.g
            animate={{
              filter:
                currentMood === 'thinking'
                  ? 'drop-shadow(0 0 4px var(--color-accent))'
                  : 'none',
            }}
          >
            {/* Left Antler */}
            <path
              d="M38 34 C36 24 26 18 20 12 C24 16 28 22 28 26 M23 15 C20 18 16 20 13 22 M27 21 C24 23 20 25 17 28"
              stroke="var(--color-accent)"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Right Antler */}
            <path
              d="M62 34 C64 24 74 18 80 12 C76 16 72 22 72 26 M77 15 C80 18 84 20 87 22 M73 21 C76 23 80 25 83 28"
              stroke="var(--color-accent)"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>

          {/* Ears with interactive twitches */}
          <motion.g variants={earVariants} animate={currentMood}>
            {/* Left Ear */}
            <ellipse
              cx="38"
              cy="28"
              rx="5"
              ry="16"
              transform="rotate(-15 38 28)"
              fill="var(--color-text-primary)"
            />
            <ellipse
              cx="38"
              cy="28"
              rx="2.5"
              ry="11"
              transform="rotate(-15 38 28)"
              fill="var(--color-accent)"
              fillOpacity="0.45"
            />

            {/* Right Ear */}
            <ellipse
              cx="62"
              cy="28"
              rx="5"
              ry="16"
              transform="rotate(15 62 28)"
              fill="var(--color-text-primary)"
            />
            <ellipse
              cx="62"
              cy="28"
              rx="2.5"
              ry="11"
              transform="rotate(15 62 28)"
              fill="var(--color-accent)"
              fillOpacity="0.45"
            />
          </motion.g>

          {/* Silhouette Head & Body */}
          <ellipse
            cx="50"
            cy="70"
            rx="24"
            ry="20"
            fill="var(--color-text-primary)"
          />
          <circle
            cx="50"
            cy="46"
            r="17"
            fill="var(--color-text-primary)"
          />

          {/* Cheeks / Muzzle */}
          <circle cx="45" cy="50" r="6" fill="var(--color-text-primary)" />
          <circle cx="55" cy="50" r="6" fill="var(--color-text-primary)" />

          {/* Nose */}
          <polygon
            points="50,49 47,46 53,46"
            fill="var(--color-accent)"
          />

          {/* Eyes (Reflective / Reactive) */}
          <motion.g>
            {currentMood === 'sleep' ? (
              <>
                <path d="M42 43 Q44 46 46 43" stroke="#111827" strokeWidth="2" strokeLinecap="round" fill="none" />
                <path d="M54 43 Q56 46 58 43" stroke="#111827" strokeWidth="2" strokeLinecap="round" fill="none" />
              </>
            ) : (
              <>
                <circle cx="43" cy="43" r="2.8" fill="#111827" />
                <circle cx="42" cy="42" r="1" fill="#ffffff" />
                <circle cx="57" cy="43" r="2.8" fill="#111827" />
                <circle cx="56" cy="42" r="1" fill="#ffffff" />
              </>
            )}
          </motion.g>

          {/* Whiskers */}
          <line x1="36" y1="49" x2="26" y2="47" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="36" y1="52" x2="27" y2="54" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="64" y1="49" x2="74" y2="47" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="64" y1="52" x2="73" y2="54" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" />

          {/* Paws */}
          <ellipse cx="40" cy="84" rx="6" ry="4" fill="var(--color-text-secondary)" />
          <ellipse cx="60" cy="84" rx="6" ry="4" fill="var(--color-text-secondary)" />
        </svg>
      </motion.button>
    </div>
  );
}
