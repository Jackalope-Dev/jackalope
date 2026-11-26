import { FileText, SquareSlash } from 'lucide-react';
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComposerCommand } from '../../lib/composer-commands';
import './composer.css';

export interface ComposerMenuOption {
  id: string;
  label: string;
  detail?: string;
  argument?: string;
  command?: ComposerCommand;
  file?: string;
}

/**
 * The suggestion list above a composer. Focus stays in the textarea, which points at
 * the highlighted option with `aria-activedescendant` (`<id>-<index>`, since file paths
 * can hold spaces an ID reference cannot); options choose on pointer down so the field
 * keeps its caret.
 */
export function ComposerMenu({
  id,
  label,
  options,
  active,
  hint,
  onHover,
  onChoose,
}: {
  id: string;
  label: string;
  options: ComposerMenuOption[];
  active: number;
  hint?: string;
  onHover: (index: number) => void;
  onChoose: (option: ComposerMenuOption) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const placement = useMenuPlacement(list, options.length);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div
      className="composer-menu"
      data-placement={placement.side}
      style={placement.maxHeight ? { maxHeight: placement.maxHeight } : undefined}
      ref={list}
    >
      <div id={id} role="listbox" aria-label={label}>
        {options.map((option, index) => (
          <div
            key={option.id}
            id={`${id}-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            data-index={index}
            className="composer-menu-option"
            onPointerDown={(event) => {
              event.preventDefault();
              onChoose(option);
            }}
            onPointerMove={() => index !== active && onHover(index)}
          >
            {option.file ? (
              <FileText size={14} aria-hidden="true" />
            ) : (
              <SquareSlash size={14} aria-hidden="true" />
            )}
            <span className="composer-menu-label">
              {option.label}
              {option.argument && (
                <span className="composer-menu-argument"> {option.argument}</span>
              )}
            </span>
            {option.detail && <span className="composer-menu-detail">{option.detail}</span>}
          </div>
        ))}
      </div>
      {hint && (
        <p className="composer-menu-hint" role="status">
          {hint}
        </p>
      )}
    </div>
  );
}

const GAP = 6;
const MARGIN = 8;
/** Enough room above for a few rows before the menu opens below the composer instead. */
const MIN_ABOVE = 160;

function clippingBounds(node: HTMLElement) {
  let top = 0;
  let bottom = window.innerHeight;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
      const rect = parent.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
  }
  return { top, bottom };
}

/**
 * Opens the menu on whichever side of its composer has room inside the panels that clip
 * it, and caps its height to that room so every option stays reachable by scrolling.
 */
function useMenuPlacement(menu: RefObject<HTMLDivElement | null>, count: number) {
  const [placement, setPlacement] = useState<{ side: 'above' | 'below'; maxHeight?: number }>({
    side: 'above',
  });
  useLayoutEffect(() => {
    const node = menu.current;
    const anchor = node?.offsetParent;
    // The option count changes the height wanted, so it re-measures as the list filters.
    if (!count || !node || !(anchor instanceof HTMLElement)) return;
    const measure = () => {
      const bounds = clippingBounds(anchor);
      const rect = anchor.getBoundingClientRect();
      const above = rect.top - bounds.top - GAP - MARGIN;
      const below = bounds.bottom - rect.bottom - GAP - MARGIN;
      const wanted = node.scrollHeight;
      const side = above >= Math.min(wanted, MIN_ABOVE) || above >= below ? 'above' : 'below';
      const room = Math.floor(side === 'above' ? above : below);
      setPlacement((current) =>
        current.side === side && current.maxHeight === room ? current : { side, maxHeight: room },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [menu, count]);
  return placement;
}
