import * as Dialog from '@radix-ui/react-dialog';
import { MessageSquare } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { type ReleaseNotes, shouldShowReleaseNotes } from '../../lib/release-notes';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useUpdateStore } from '../../stores/updateStore';
import { FeedbackDialog } from '../settings/FeedbackDialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { welcomePending } from './WelcomeDialog';

const SEEN_KEY = 'jackalope.whats-new.seen-version';

// Captured when the app starts: someone finishing setup in this session is on
// a fresh install and has nothing to catch up on.
const setupCompleteAtLaunch = useOnboardingStore.getState().status === 'complete';
// The first-launch welcome replaces release notes; one introduction is enough.
const welcomeAtLaunch = welcomePending();

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen(version: string) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Without storage the notes may show again next launch; nothing else breaks.
  }
}

/** Renders `code` spans in a release note line. */
function inline(text: string): ReactNode {
  let offset = 0;
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) => {
      const key = `${offset}`;
      offset += part.length;
      return part.startsWith('`') && part.endsWith('`') ? (
        <code key={key}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={key}>{part}</Fragment>
      );
    });
}

/** Once per update: what changed in this version, with a way to send feedback. */
export function WhatsNewDialog() {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const done = useRef<HTMLButtonElement>(null);
  const beta = useUpdateStore((state) => state.release?.channel === 'beta');
  const loadRelease = useUpdateStore((state) => state.load);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    void (async () => {
      const { getVersion } = await import('@tauri-apps/api/app');
      const version = await getVersion();
      if (welcomeAtLaunch || !shouldShowReleaseNotes(version, readSeen(), setupCompleteAtLaunch)) {
        markSeen(version);
        return;
      }
      const { loadReleaseNotes } = await import('../../lib/release-notes-loader');
      const loaded = await loadReleaseNotes(version);
      markSeen(version);
      if (alive && loaded) {
        await loadRelease().catch(() => {});
        if (alive) setNotes(loaded);
      }
    })().catch(() => {
      // Notes are a courtesy; a missing file or version must not interrupt work.
    });
    return () => {
      alive = false;
    };
  }, [loadRelease]);

  return (
    <>
      <Dialog.Root open={!!notes} onOpenChange={(open) => !open && setNotes(null)}>
        {notes && (
          <DialogContent
            className="whats-new"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              done.current?.focus();
            }}
          >
            <DialogCloseButton label="Close what's new" />
            <DialogHeader
              title={
                <span className="flex items-center gap-2">
                  What's new in Jackalope {notes.version}
                  {beta && <Badge variant="accent">Beta</Badge>}
                </span>
              }
              description={
                beta
                  ? "Here's what changed since your last update. Beta builds include early changes that may be less stable."
                  : "Here's what changed since your last update."
              }
            />
            <div className="whats-new-body">
              {notes.sections.map((section) => (
                <section key={section.title}>
                  <h3>{section.title}</h3>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{inline(item)}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setNotes(null);
                  setFeedbackOpen(true);
                }}
              >
                <MessageSquare size={16} aria-hidden="true" />
                Share feedback
              </Button>
              <Button ref={done} onClick={() => setNotes(null)}>
                Got it
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog.Root>
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onCloseAutoFocus={(event) => event.preventDefault()}
      />
    </>
  );
}
