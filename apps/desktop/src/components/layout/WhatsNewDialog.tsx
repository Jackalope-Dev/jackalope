import * as Dialog from '@radix-ui/react-dialog';
import { MessageSquare } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { type ReleaseNotes, shouldShowReleaseNotes } from '../../lib/release-notes';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { FeedbackDialog } from '../settings/FeedbackDialog';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';

const SEEN_KEY = 'jackalope.whats-new.seen-version';

// Captured when the app starts: someone finishing setup in this session is on
// a fresh install and has nothing to catch up on.
const setupCompleteAtLaunch = useOnboardingStore.getState().status === 'complete';

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

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    void (async () => {
      const { getVersion } = await import('@tauri-apps/api/app');
      const version = await getVersion();
      if (!shouldShowReleaseNotes(version, readSeen(), setupCompleteAtLaunch)) {
        markSeen(version);
        return;
      }
      const { loadReleaseNotes } = await import('../../lib/release-notes-loader');
      const loaded = await loadReleaseNotes(version);
      markSeen(version);
      if (alive && loaded) setNotes(loaded);
    })().catch(() => {
      // Notes are a courtesy; a missing file or version must not interrupt work.
    });
    return () => {
      alive = false;
    };
  }, []);

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
              title={`What's new in Jackalope ${notes.version}`}
              description="Here's what changed since your last update."
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
