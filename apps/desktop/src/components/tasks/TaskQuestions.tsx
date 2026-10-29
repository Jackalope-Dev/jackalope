import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useWorkViewStore } from '../../stores/workViewStore';
import { ResizeHandle } from '../ui/ResizeHandle';

const MIN_HEIGHT = 120;
// Room kept below the questions for the section tabs and the follow-up composer.
const KEEP_BELOW = 260;

/**
 * Waiting questions above the task sections, sized to their content up to most of the
 * page and resizable from the handle beneath them; the chosen height is remembered.
 */
export function TaskQuestions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useWorkViewStore((state) => state.sizes['task-questions']);
  const [shown, setShown] = useState(0);
  const [limit, setLimit] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    const page = element?.parentElement;
    if (!element || !page) return;
    const measure = () => {
      setShown(element.getBoundingClientRect().height);
      setLimit(Math.max(MIN_HEIGHT, page.clientHeight - KEEP_BELOW));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);
  const setHeight = (size: number | null) =>
    useWorkViewStore.getState().setSize('task-questions', size);
  return (
    <>
      <div
        ref={ref}
        className="task-questions"
        id="task-questions"
        style={height === undefined ? undefined : { height, maxHeight: limit || undefined }}
      >
        {children}
      </div>
      <ResizeHandle
        orientation="horizontal"
        label="Resize questions"
        controls="task-questions"
        className="task-questions-resizer"
        value={height ?? shown}
        min={MIN_HEIGHT}
        max={Math.max(MIN_HEIGHT, limit)}
        onResize={setHeight}
        onReset={() => setHeight(null)}
      />
    </>
  );
}
