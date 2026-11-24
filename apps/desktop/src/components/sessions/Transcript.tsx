import { describeError } from '@jackalope/contracts/errors';
import { Button, IconButton, Input } from '@jackalope/ui';
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  type ReactNode,
  type Ref,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useKeybindingHandlers } from '../../hooks/useKeybindings';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import {
  MarkdownHighlighterContext,
  type SharedMarkdownHighlighter,
} from '../../lib/markdown-highlighter-context';
import {
  findMatches,
  firstMatchFrom,
  matchLabel,
  stepMatch,
  type TranscriptMatch,
  textRanges,
} from '../../lib/transcript-find';
import {
  distanceFromEnd,
  followAfterScroll,
  jumpBehavior,
  type ScrollSample,
  sampleScroll,
} from '../../lib/transcript-follow';
import './transcript.css';

export interface TranscriptRow {
  key: string;
  /**
   * Searchable text, one entry per element in the row marked `data-find-part="<index>"`;
   * null while that text is not loaded, when `searchUnloaded` counts it instead.
   */
  text: readonly (string | null)[];
  /** Expected height in pixels until the row has rendered and been measured. */
  estimate: number;
}

export interface TranscriptHandle {
  /** Shows the newest content and follows it again, as after sending a message. */
  scrollToLatest: () => void;
}

/** Rows a text selection keeps rendered, so selecting across a long stretch stays intact. */
const SELECTION_ROWS = 400;
const MATCHES = 'transcript-match';
const CURRENT = 'transcript-match-current';
const highlights = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
    ? CSS.highlights
    : null;

const rowOf = (node: Node | null) =>
  (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-index]');

/**
 * A long conversation that renders only the rows near the viewport. It follows new content
 * while the person is at the end, offers Jump to latest once they read back, and finds
 * text in every row, rendered or not. Rows are measured as they render, and the reading
 * position holds while rows above it measure or format.
 */
export function Transcript({
  rows,
  renderRow,
  before,
  after,
  footer,
  jumpToLatest = true,
  items,
  className,
  label,
  handle,
  searchUnloaded,
}: {
  rows: readonly TranscriptRow[];
  renderRow: (index: number) => ReactNode;
  /** Shown above the rows, such as an empty state. */
  before?: ReactNode;
  /** Shown after the rows, such as live activity and questions. */
  after?: ReactNode;
  /** Placed last in the scroller without a wrapper, so it can stick to the bottom. */
  footer?: ReactNode;
  /** Off where something else already sits at the bottom of the view. */
  jumpToLatest?: boolean;
  /** Messages and replies so far; those added while reading back are counted on Jump to latest. */
  items: number;
  className?: string;
  /** What the transcript holds, as in "Find in conversation". */
  label: string;
  handle?: Ref<TranscriptHandle>;
  /** Occurrences of a query in each row's unloaded text, by row key. */
  searchUnloaded?: (query: string) => Promise<ReadonlyMap<string, number>>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const trailing = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shared = useMemo<SharedMarkdownHighlighter>(() => ({}), []);
  useEffect(() => () => shared.current?.dispose(), [shared]);
  const reducedMotion = useReducedMotionPreference();

  const following = useRef(true);
  const [isFollowing, setIsFollowing] = useState(true);
  const itemCount = useRef(items);
  itemCount.current = items;
  const baseline = useRef(items);
  const follow = useCallback((value: boolean) => {
    if (following.current === value) return;
    following.current = value;
    if (!value) baseline.current = itemCount.current;
    setIsFollowing(value);
  }, []);
  const lastScroll = useRef<ScrollSample | null>(null);
  /** A find result being brought into view while its row renders and formats. */
  const pending = useRef<{ match: TranscriptMatch; until: number } | null>(null);
  const readingTop = useRef(0);
  const stick = useCallback(() => {
    const node = scroller.current;
    if (node?.clientHeight && following.current) node.scrollTop = node.scrollHeight;
  }, []);
  // Every commit can grow the rows or what follows them. This runs before the virtualizer
  // reads the position, so its first range is the end.
  useLayoutEffect(() => stick());

  const [margin, setMargin] = useState(0);
  const [selected, setSelected] = useState<readonly [number, number] | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (!selected && focused === null) return indexes;
      const all = new Set(indexes);
      if (selected) for (let index = selected[0]; index <= selected[1]; index++) all.add(index);
      if (focused !== null) all.add(focused);
      return [...all].filter((index) => index < range.count).sort((a, b) => a - b);
    },
    [selected, focused],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => rows[index]?.estimate ?? 120,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 6,
    scrollMargin: margin,
    initialOffset: () => rows.reduce((total, row) => total + row.estimate, 0),
    rangeExtractor,
  });
  useLayoutEffect(() => {
    const top = list.current?.offsetTop ?? 0;
    if (top !== margin) setMargin(top);
  });

  // Follow a resized viewport and what follows the rows growing on its own, and come back
  // to the same place after being hidden. Rows are not observed here: their growth
  // re-renders this component through the virtualizer.
  useEffect(() => {
    const node = scroller.current;
    const tail = trailing.current;
    if (!node || !tail) return;
    let shown = node.clientHeight > 0;
    const observer = new ResizeObserver(() => {
      if (node.clientHeight > 0 && !shown && !following.current)
        node.scrollTop = readingTop.current;
      shown = node.clientHeight > 0;
      stick();
    });
    observer.observe(node);
    observer.observe(tail);
    return () => observer.disconnect();
  }, [stick]);

  // A selection or focused control keeps its rows rendered while they scroll away.
  useEffect(() => {
    const update = () => {
      const container = list.current;
      const selection = document.getSelection();
      if (!container || !selection || selection.isCollapsed || !selection.rangeCount) {
        setSelected(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!range.intersectsNode(container)) {
        setSelected(null);
        return;
      }
      const edge = (node: Node, start: boolean) => {
        const row = container.contains(node) ? rowOf(node) : null;
        if (row) return Number(row.dataset.index);
        const children = container.children;
        const element = children[start ? 0 : children.length - 1] as HTMLElement | undefined;
        return Number(element?.dataset.index ?? 0);
      };
      const from = edge(range.startContainer, true);
      const to = Math.min(edge(range.endContainer, false), from + SELECTION_ROWS);
      setSelected((value) => (value?.[0] === from && value[1] === to ? value : [from, to]));
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const node = scroller.current;
      if (!node) return;
      follow(true);
      pending.current = null;
      node.scrollTo({ top: node.scrollHeight, behavior });
    },
    [follow],
  );
  useImperativeHandle(handle, () => ({ scrollToLatest: () => scrollToLatest() }), [scrollToLatest]);

  // Find searches the rows' data; highlights mark what is rendered.
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const searched = useDeferredValue(findOpen ? query.trim() : '');
  const searchedRows = useDeferredValue(rows);
  const hasUnloaded = searchedRows.some((row) => row.text.includes(null));
  const [remote, setRemote] = useState<{
    query: string;
    counts?: ReadonlyMap<string, number>;
    error?: string;
  }>({ query: '' });
  const searchRef = useRef(searchUnloaded);
  searchRef.current = searchUnloaded;
  useEffect(() => {
    const search = searchRef.current;
    if (!searched || !hasUnloaded || !search) return;
    let live = true;
    search(searched).then(
      (counts) => live && setRemote({ query: searched, counts }),
      (cause) => live && setRemote({ query: searched, error: describeError(cause) }),
    );
    return () => {
      live = false;
    };
  }, [searched, hasUnloaded]);
  const found = useMemo(() => {
    const counts = remote.query === searched ? remote.counts : undefined;
    const unloaded = new Map<number, number>();
    if (counts)
      searchedRows.forEach((row, index) => {
        const count = counts.get(row.key);
        if (count) unloaded.set(index, count);
      });
    return findMatches(
      searchedRows.map((row) => row.text),
      searched,
      unloaded,
    );
  }, [searchedRows, searched, remote]);
  const remoteError = remote.query === searched ? remote.error : undefined;
  const paintState = useRef({ found, current, searched });
  paintState.current = { found, current, searched };
  const frame = useRef(0);
  const paint = useCallback(() => {
    frame.current = 0;
    const registry = highlights();
    const container = list.current;
    const node = scroller.current;
    const { found, current, searched } = paintState.current;
    for (const marked of container?.querySelectorAll('[data-find-current]') ?? [])
      marked.removeAttribute('data-find-current');
    if (!searched || !container || !node) {
      registry?.delete(MATCHES);
      registry?.delete(CURRENT);
      return;
    }
    const target = found.matches[current];
    const all: globalThis.Range[] = [];
    let currentRange: globalThis.Range | undefined;
    for (const row of container.children as HTMLCollectionOf<HTMLElement>) {
      const index = Number(row.dataset.index);
      for (const part of row.querySelectorAll<HTMLElement>('[data-find-part]')) {
        const ranges = textRanges(part, searched);
        all.push(...ranges);
        if (target?.row === index && Number(part.dataset.findPart) === target.part) {
          currentRange = ranges[Math.min(target.nth, ranges.length - 1)];
          // Without the highlight API, the part holding the current match is outlined.
          if (!registry) part.setAttribute('data-find-current', '');
        }
      }
    }
    if (registry) {
      registry.set(MATCHES, new Highlight(...all));
      if (currentRange) registry.set(CURRENT, new Highlight(currentRange));
      else registry.delete(CURRENT);
    }
    const request = pending.current;
    if (!request) return;
    if (performance.now() > request.until) {
      pending.current = null;
      return;
    }
    const box = (
      currentRange ?? container.querySelector(`[data-index="${request.match.row}"]`)
    )?.getBoundingClientRect();
    if (!box) return;
    const view = node.getBoundingClientRect();
    const inset = Math.min(64, view.height / 4);
    if (box.top < view.top + inset || box.bottom > view.bottom - inset)
      node.scrollTop += box.top - view.top - (view.height - box.height) / 2;
  }, []);
  const schedulePaint = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);
  useEffect(() => {
    const container = list.current;
    if (!container || !searched) return;
    const observer = new MutationObserver(schedulePaint);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [searched, schedulePaint]);
  const painted = useRef(false);
  useEffect(() => {
    if (!searched && !painted.current) return;
    painted.current = !!searched;
    schedulePaint();
  });
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      highlights()?.delete(MATCHES);
      highlights()?.delete(CURRENT);
    },
    [],
  );

  const reveal = useCallback(
    (match: TranscriptMatch | undefined) => {
      if (!match) return;
      follow(false);
      pending.current = { match, until: performance.now() + 1500 };
      if (!list.current?.querySelector(`[data-index="${match.row}"]`))
        virtualizer.scrollToIndex(match.row, { align: 'center' });
      schedulePaint();
    },
    [follow, virtualizer, schedulePaint],
  );
  // A new query, or counts for unloaded text arriving, starts again from the reading position.
  const searchKey = `${searched}\u0000${remote.query === searched && remote.counts ? 1 : 0}`;
  const lastSearch = useRef('');
  useEffect(() => {
    if (lastSearch.current === searchKey) {
      if (current >= found.matches.length) setCurrent(found.matches.length - 1);
      return;
    }
    lastSearch.current = searchKey;
    const range = virtualizer.range;
    const index = firstMatchFrom(found.matches, range?.startIndex ?? 0);
    setCurrent(index);
    reveal(found.matches[index]);
  }, [found, searchKey, current, virtualizer, reveal]);
  const step = (direction: 1 | -1) => {
    const next = stepMatch(current, found.matches.length, direction);
    setCurrent(next);
    reveal(found.matches[next]);
  };
  const closeFind = () => {
    setFindOpen(false);
    pending.current = null;
    const target = returnFocus.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else scroller.current?.focus({ preventScroll: true });
  };

  useKeybindingHandlers({
    find: (event) => {
      const element = root.current;
      // Hidden behind another view, such as Review or Terminal.
      if (!element?.getClientRects().length) return false;
      // Another conversation holds focus and finds in its own transcript.
      const target = event.target instanceof Element ? event.target : null;
      const scope = target?.closest('[data-transcript-scope]');
      if (scope && !scope.contains(element)) return false;
      if (!element.contains(document.activeElement) || !findOpen)
        returnFocus.current =
          document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : null;
      const selection = document.getSelection();
      const chosen = selection?.toString().trim() ?? '';
      if (
        chosen &&
        chosen.length <= 200 &&
        !chosen.includes('\n') &&
        list.current &&
        selection?.anchorNode &&
        list.current.contains(selection.anchorNode)
      )
        setQuery(chosen);
      setFindOpen(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    },
  });

  const fresh = Math.max(0, items - baseline.current);
  const jumpLabel = fresh
    ? `Jump to latest, ${fresh} new ${fresh === 1 ? 'item' : 'items'}`
    : 'Jump to latest';
  const virtualItems = virtualizer.getVirtualItems();
  return (
    <MarkdownHighlighterContext.Provider value={shared}>
      <div ref={root} className="transcript">
        {findOpen && (
          // biome-ignore lint/a11y/useSemanticElements: a search landmark around a find bar, not a form that submits
          <div className="transcript-find" role="search" aria-label={`Find in ${label}`}>
            <Input
              ref={input}
              value={query}
              type="search"
              onChange={(event) => setQuery(event.currentTarget.value)}
              aria-label={`Find in ${label}`}
              placeholder={`Find in ${label}`}
              className="transcript-find-field"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  step(event.shiftKey ? -1 : 1);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeFind();
                }
              }}
            />
            <span className="transcript-find-count" role="status">
              {remoteError ??
                (searched ? matchLabel(current, found.matches.length, found.truncated) : '')}
            </span>
            <IconButton
              label="Previous match"
              disabled={!found.matches.length}
              onClick={() => step(-1)}
            >
              <ChevronUp size={16} aria-hidden="true" />
            </IconButton>
            <IconButton label="Next match" disabled={!found.matches.length} onClick={() => step(1)}>
              <ChevronDown size={16} aria-hidden="true" />
            </IconButton>
            <IconButton label="Close find" onClick={closeFind}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        <section
          ref={scroller}
          className={`transcript-scroll${className ? ` ${className}` : ''}`}
          aria-label={`${label.charAt(0).toUpperCase()}${label.slice(1)}`}
          tabIndex={-1}
          onScroll={(event) => {
            const node = event.currentTarget;
            if (!node.clientHeight) return;
            const sample = sampleScroll(node);
            follow(followAfterScroll(following.current, lastScroll.current, sample));
            lastScroll.current = sample;
            readingTop.current = sample.top;
          }}
          onWheel={(event) => {
            pending.current = null;
            if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) follow(false);
          }}
          onKeyDown={(event) => {
            if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
              pending.current = null;
          }}
          onFocus={(event) => {
            const row = list.current?.contains(event.target) ? rowOf(event.target) : null;
            setFocused(row ? Number(row.dataset.index) : null);
          }}
          onBlur={(event) => {
            if (!list.current?.contains(event.relatedTarget)) setFocused(null);
          }}
        >
          {before}
          <div
            ref={list}
            className="transcript-rows"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="transcript-row"
                style={{ transform: `translateY(${item.start - margin}px)` }}
              >
                {renderRow(item.index)}
              </div>
            ))}
          </div>
          <div ref={trailing}>{after}</div>
          {footer}
        </section>
        {jumpToLatest && !isFollowing && (
          <Button
            variant="secondary"
            size="sm"
            className="transcript-jump"
            aria-label={jumpLabel}
            onClick={(event) => {
              const node = scroller.current;
              const keyboard = event.currentTarget === document.activeElement;
              if (!node) return;
              scrollToLatest(
                jumpBehavior(distanceFromEnd(sampleScroll(node)), node.clientHeight, reducedMotion),
              );
              if (keyboard) node.focus({ preventScroll: true });
            }}
          >
            <ArrowDown size={14} aria-hidden="true" />
            Jump to latest
            {!!fresh && <span className="transcript-jump-count">{fresh} new</span>}
          </Button>
        )}
      </div>
    </MarkdownHighlighterContext.Provider>
  );
}
