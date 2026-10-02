import * as Dialog from '@radix-ui/react-dialog';
import { GitCompareArrows, Layers, Megaphone, MessageCircleHeart, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { FeedbackDialog } from '../settings/FeedbackDialog';
import { Button } from '../ui/button';
import './welcome.css';

const SEEN_KEY = 'jackalope.welcome.seen';

/** True until the welcome has been dismissed once. `?welcome` forces it for review. */
export function welcomePending(): boolean {
  if (new URLSearchParams(location.search).has('welcome')) return true;
  try {
    return localStorage.getItem(SEEN_KEY) === null;
  } catch {
    // Without storage the welcome would return every launch; skip it instead.
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Already treated as seen when storage is unavailable.
  }
}

const features = [
  {
    icon: Layers,
    title: 'Agents side by side',
    detail: 'Each task runs in its own worktree, so Claude, Codex and others never collide.',
  },
  {
    icon: GitCompareArrows,
    title: 'Review before it lands',
    detail: 'Changes, checks and merge sit together. Nothing reaches your branch unseen.',
  },
  {
    icon: Sparkles,
    title: 'Focus, Build or Oversee',
    detail: 'Pick the layout that fits the moment, from one task to a full board.',
  },
  {
    icon: MessageCircleHeart,
    title: 'Jackalope keeps watch',
    detail: 'The mascot in the corner flags questions, reviews and updates as they happen.',
  },
];

const rise = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] as const } },
};

/** A one-time, full-screen hello: what Jackalope does, that it's in beta, and how to tell us. */
export function WelcomeDialog() {
  const [open, setOpen] = useState(welcomePending);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [cheering, setCheering] = useState(true);
  const start = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setCheering(false), 1800);
    return () => window.clearTimeout(timer);
  }, [open]);

  const close = (then?: () => void) => {
    markSeen();
    setOpen(false);
    then?.();
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(value) => !value && close()}>
        <Dialog.Portal>
          <Dialog.Overlay className="welcome-overlay" />
          <Dialog.Content
            className="welcome"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              start.current?.focus({ preventScroll: true });
            }}
          >
            <div className="welcome-glow" aria-hidden="true" />
            <motion.div
              className="welcome-body"
              initial="hidden"
              animate="shown"
              variants={{ shown: { transition: { staggerChildren: reduceMotion ? 0 : 0.08 } } }}
            >
              <motion.div
                className="welcome-mascot"
                variants={{
                  hidden: { opacity: 0, scale: 0.6, y: 24 },
                  shown: {
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    transition: { type: 'spring', stiffness: 220, damping: 14 },
                  },
                }}
              >
                <JackalopeMascot
                  size="lg"
                  showBubble={false}
                  overrideMood={cheering ? 'success' : 'idle'}
                />
              </motion.div>
              <motion.p className="welcome-badge" variants={rise}>
                <span aria-hidden="true" className="welcome-badge-dot" />
                Public beta
              </motion.p>
              <motion.div variants={rise}>
                <Dialog.Title className="welcome-title">Welcome to Jackalope</Dialog.Title>
              </motion.div>
              <motion.div variants={rise}>
                <Dialog.Description className="welcome-lede">
                  One place to run coding agents, review what they change and ship with confidence.
                </Dialog.Description>
              </motion.div>
              <ul className="welcome-features">
                {features.map(({ icon: Icon, title, detail }) => (
                  <motion.li key={title} variants={rise} className="welcome-feature">
                    <span className="welcome-feature-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <span>{detail}</span>
                    </span>
                  </motion.li>
                ))}
              </ul>
              <motion.div variants={rise} className="welcome-beta">
                <Megaphone size={18} aria-hidden="true" />
                <p>
                  <strong>You’re early, and that helps.</strong> Expect rough edges. Tell us what
                  breaks, what’s confusing or what you wish it did. Feedback is always one click
                  away in the bottom bar.
                </p>
              </motion.div>
              <motion.div variants={rise} className="welcome-actions">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => close(() => setFeedbackOpen(true))}
                >
                  Share feedback
                </Button>
                <Button ref={start} size="lg" onClick={() => close()}>
                  Get started
                </Button>
              </motion.div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onCloseAutoFocus={(event) => event.preventDefault()}
      />
    </>
  );
}
