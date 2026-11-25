import { FileText, SquareSlash } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div className="composer-menu" ref={list}>
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
