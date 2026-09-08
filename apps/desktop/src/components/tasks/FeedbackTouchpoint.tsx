import { useEffect, useRef, useState } from 'react';
import { isActive } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useFeedbackStore } from '../../stores/feedbackStore';
import { openSettings } from '../layout/navigation';
import { FeedbackForm } from '../settings/FeedbackForm';
import { Button } from '../ui/button';

export function FeedbackTouchpoint({ runId, paused }: { runId: string; paused: boolean }) {
  const { view, request } = useFeedbackStore();
  const configured = useCommunityStore((state) => state.settings?.configured);
  const working = useExecutionStore((state) => state.submitting || state.runs.some(isActive));
  const [invitation, setInvitation] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const slot = useRef<HTMLElement>(null);
  const claiming = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.5,
    });
    if (slot.current) observer.observe(slot.current);
    return () => { mounted.current = false; observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (paused || working) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible' && document.hasFocus())
        timer = setTimeout(() => {
          void request({ action: 'activity', runId });
        }, 15_000);
    };
    arm();
    window.addEventListener('focus', arm);
    window.addEventListener('blur', arm);
    document.addEventListener('visibilitychange', arm);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', arm);
      window.removeEventListener('blur', arm);
      document.removeEventListener('visibilitychange', arm);
    };
  }, [runId, paused, working, request]);
  useEffect(() => {
    if (
      !configured || !view?.eligible ||
      !visible ||
      paused ||
      working ||
      invitation ||
      claiming.current ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus()
    )
      return;
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    claiming.current = true;
    const id = crypto.randomUUID();
    void request({ action: 'claim', id }).then((result) => {
      if (mounted.current && result?.claimed) setInvitation(id);
      claiming.current = false;
    });
  }, [configured, view?.eligible, visible, paused, working, invitation, request]);
  const dismiss = async (action: 'later' | 'stop') => {
    if (!invitation) return;
    setInvitation(null);
    setWriting(false);
    const result = await request(action === 'later' ? { action, id: invitation } : { action });
    if (!result)
      setError(
        'Your choice could not sync. Invitations are paused here; retry in account settings when connected.',
      );
  };
  return (
    <section ref={slot} className="feedback-touchpoint" aria-label="Feedback on Jackalope">
      {thanks ? (
        <p role="status">Thanks. Your feedback is in our private inbox.</p>
      ) : writing ? (
        <FeedbackForm
          invited
          onSubmitted={() => {
            setWriting(false);
            setThanks(true);
          }}
        />
      ) : invitation && !view?.completed && !paused && !working ? (
        <>
          <p className="font-medium">How is Jackalope fitting into your workflow?</p>
          <p className="task-muted">
            What’s useful, and what could feel better? A sentence or two is plenty.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setWriting(true)}>
              Share thoughts
            </Button>
            <Button variant="ghost" onClick={() => void dismiss('later')}>
              Later
            </Button>
            <Button variant="ghost" onClick={() => void dismiss('stop')}>
              Don’t ask again
            </Button>
          </div>
        </>
      ) : (
        <Button variant="ghost" onClick={() => openSettings('Updates & support')}>
          Share feedback on Jackalope
        </Button>
      )}
      {error && (
        <p role="status" className="task-muted">
          {error}
        </p>
      )}
    </section>
  );
}
