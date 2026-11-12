import { Check, CircleAlert, CircleCheck, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { SearchField } from './SearchField';
import { cn } from './utils';
import './choice.css';
import './stepper.css';
import './setup.css';

/**
 * A setup screen's frame: the steps at a comfortable reading measure on the left and, on wide
 * panes, a sticky aside on the right taking the rest of the width for the live picture (the
 * SetupIntro, a FlowDiagram and a SetupSummary). Narrow panes stack, aside first, so the
 * picture leads.
 */
export function SetupLayout({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  // The outer element is the size container; a container query can't style the container
  // itself, so the grid lives one level in.
  return (
    <div className={cn('ui-setup-layout', className)}>
      <div className="ui-setup-grid" data-aside={aside ? true : undefined}>
        <div className="ui-setup-main">{children}</div>
        {aside && <aside className="ui-setup-aside">{aside}</aside>}
      </div>
    </div>
  );
}

export interface SetupSummaryItem {
  label: ReactNode;
  value: ReactNode;
}

/** The choices made so far as label and value pairs, kept current as the person works. */
export function SetupSummary({
  items,
  label,
  className,
}: {
  items: SetupSummaryItem[];
  /** Names the summary for assistive technology, such as "Connection so far". */
  label: string;
  className?: string;
}) {
  return (
    <dl className={cn('ui-setup-summary', className)} aria-label={label}>
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional display copy
        <div key={index} className="ui-setup-summary-row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The top of a setup or settings screen: an icon, one sentence on what the feature does for
 * the person, an optional visual of how it works and an optional action. Compact, so the
 * steps below stay in view.
 */
export function SetupIntro({
  icon,
  title,
  description,
  visual,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  /** A small explanation of how it works, such as a FlowDiagram. */
  visual?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('ui-setup-intro', className)}>
      <span className="ui-setup-intro-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="ui-setup-intro-text">
        <h2 className="ui-setup-intro-title">{title}</h2>
        <p className="ui-setup-intro-description">{description}</p>
      </div>
      {action && <div className="ui-setup-intro-action">{action}</div>}
      {visual && <div className="ui-setup-intro-visual">{visual}</div>}
    </section>
  );
}

export type SetupStepState = 'done' | 'current' | 'upcoming';

export interface SetupStep {
  id: string;
  title: ReactNode;
  /** A short line under the title on what this step needs. */
  hint?: ReactNode;
  state: SetupStepState;
  /** The step's controls, shown while it is current, open or reopened. */
  content?: ReactNode;
  /**
   * What a done step chose, stated plainly ("Over SSH to user@workstation"), shown in place
   * of its controls. Never just "Done". Without one, a done step keeps its controls open.
   */
  summary?: ReactNode;
  /** Keeps the controls open whatever the state, such as a pairing code on screen. */
  open?: boolean;
  /** The label of the button that reopens a done step; "Change" by default. */
  editLabel?: string;
  /** A step the person can skip; it never holds the flow and carries an Optional tag. */
  optional?: boolean;
}

const STEP_SPOKEN: Record<SetupStepState, string> = {
  done: ' (done)',
  current: ' (current step)',
  upcoming: '',
};

/**
 * Steps a person works through, numbered, with done, current and upcoming states shown by a
 * drawn check, a ringed number and the text weight as well as colour. The current step is
 * open; done steps fold to a stated summary with a Change button so the current step stays
 * near the top; upcoming steps show only their title and hint. Focus moves only when the
 * person asks, into a step they reopen, never as steps complete while they type.
 */
export function SetupSteps({
  steps,
  label,
  className,
}: {
  steps: SetupStep[];
  /** Names the list for assistive technology, such as "Connect a host". */
  label: string;
  className?: string;
}) {
  const baseId = useId();
  const [reopened, setReopened] = useState<ReadonlySet<string>>(new Set());
  const [focusStep, setFocusStep] = useState<string | null>(null);
  const contents = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!focusStep) return;
    const target = contents.current
      .get(focusStep)
      ?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
    target?.focus();
    setFocusStep(null);
  }, [focusStep]);
  const toggle = (id: string, open: boolean) =>
    setReopened((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <ol className={cn('ui-setup-steps', className)} aria-label={label}>
      {steps.map((step, index) => {
        const folded = step.state === 'done' && Boolean(step.summary);
        const isReopened = folded && reopened.has(step.id);
        const showContent =
          Boolean(step.content) &&
          (step.state === 'current' ||
            step.open ||
            isReopened ||
            (step.state === 'done' && !step.summary));
        const contentId = `${baseId}-${step.id}`;
        return (
          <li
            key={step.id}
            className="ui-setup-step"
            data-state={step.state}
            data-optional={step.optional || undefined}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="ui-setup-step-mark" aria-hidden="true">
              {step.state === 'done' ? (
                <svg viewBox="0 0 16 16" className="ui-stepper-check" aria-hidden="true">
                  <title>Done</title>
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <div className="ui-setup-step-body">
              <div className="ui-setup-step-head">
                <h3 className="ui-setup-step-title">
                  {step.title}
                  {step.optional && <span className="ui-setup-step-optional">Optional</span>}
                  <span className="ui-sr-only">{STEP_SPOKEN[step.state]}</span>
                </h3>
                {folded && step.content && !step.open && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ui-setup-step-edit"
                    aria-expanded={isReopened}
                    aria-controls={isReopened ? contentId : undefined}
                    onClick={() => {
                      toggle(step.id, !isReopened);
                      if (!isReopened) setFocusStep(step.id);
                    }}
                  >
                    {isReopened ? 'Done' : (step.editLabel ?? 'Change')}
                  </Button>
                )}
              </div>
              {folded && !isReopened && !step.open ? (
                <p className="ui-setup-step-summary">{step.summary}</p>
              ) : (
                step.hint && <p className="ui-setup-step-hint">{step.hint}</p>
              )}
              {showContent && (
                <div
                  id={contentId}
                  className="ui-setup-step-content"
                  ref={(node) => {
                    if (node) contents.current.set(step.id, node);
                    else contents.current.delete(step.id);
                  }}
                >
                  {step.content}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export interface ChoiceCardOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * A radio group of large cards for conceptual options, in place of a small select. Each card
 * wraps a native radio, so arrow keys move the choice and only the chosen card is a tab stop.
 * Selection shows as a tinted card plus a filled indicator, never colour alone.
 */
export function ChoiceCards<T extends string>({
  label,
  value,
  onValueChange,
  options,
  disabled,
  className,
}: {
  label: string;
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: ChoiceCardOption<T>[];
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn('ui-choice-cards', className)} disabled={disabled}>
      <legend className="ui-sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label key={option.value} className="ui-choice-card">
            <input
              type="radio"
              className="ui-sr-only"
              name={name}
              value={option.value}
              checked={selected}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
            />
            {option.icon && (
              <span className="ui-choice-card-icon" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="ui-choice-card-text">
              <span className="ui-choice-card-title">{option.title}</span>
              {option.description && (
                <span className="ui-choice-card-description">{option.description}</span>
              )}
            </span>
            <span className="ui-choice-indicator ui-choice-card-indicator" aria-hidden="true">
              {selected && <Check size={12} strokeWidth={3} />}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export interface ChoiceGridOption<T extends string> {
  value: T;
  title: ReactNode;
  /** A short second line, such as the folder that tells two same-named items apart. */
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Plain text the filter matches; the title when it is a string. */
  searchText?: string;
}

/**
 * A dense, multi-select grid of tiles for picking several items, such as projects, in place
 * of a tall column of checkboxes. Each tile wraps a native checkbox in one fieldset. Past
 * `bulkAt` options it offers Select all and None; past `filterAt` a filter field, which
 * narrows the tiles without dropping hidden selections.
 */
export function ChoiceGrid<T extends string>({
  label,
  values,
  onValuesChange,
  options,
  disabled,
  bulkAt = 6,
  filterAt = 12,
  className,
}: {
  label: string;
  values: readonly T[];
  onValuesChange: (values: T[]) => void;
  options: ChoiceGridOption<T>[];
  disabled?: boolean;
  bulkAt?: number;
  filterAt?: number;
  className?: string;
}) {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const text = (option: ChoiceGridOption<T>) =>
    (option.searchText ?? (typeof option.title === 'string' ? option.title : '')).toLowerCase();
  const shown =
    options.length > filterAt && query
      ? options.filter((option) => text(option).includes(query))
      : options;
  const chosen = new Set(values);
  const enabled = options.filter((option) => !option.disabled).map((option) => option.value);
  return (
    <fieldset className={cn('ui-choice-grid', className)} disabled={disabled}>
      <legend className="ui-sr-only">{label}</legend>
      {options.length > bulkAt && (
        <div className="ui-choice-grid-toolbar">
          {options.length > filterAt && (
            <SearchField
              value={filter}
              onValueChange={setFilter}
              placeholder="Filter…"
              aria-label={`Filter ${label.toLowerCase()}`}
              containerClassName="ui-choice-grid-filter"
            />
          )}
          <span className="ui-choice-grid-count" aria-live="polite">
            {values.length} of {options.length} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={enabled.every((value) => chosen.has(value))}
            onClick={() => onValuesChange([...new Set([...values, ...enabled])])}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!values.length}
            onClick={() => onValuesChange([])}
          >
            None
          </Button>
        </div>
      )}
      <div className="ui-choice-grid-tiles">
        {shown.map((option) => {
          const checked = chosen.has(option.value);
          return (
            <label key={option.value} className="ui-choice-tile">
              <input
                type="checkbox"
                className="ui-sr-only"
                checked={checked}
                disabled={option.disabled}
                onChange={(event) =>
                  onValuesChange(
                    event.target.checked
                      ? [...values, option.value]
                      : values.filter((value) => value !== option.value),
                  )
                }
              />
              {option.icon && (
                <span className="ui-choice-tile-icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="ui-choice-tile-text">
                <span className="ui-choice-tile-title">{option.title}</span>
                {option.description && (
                  <span className="ui-choice-tile-description">{option.description}</span>
                )}
              </span>
              <span className="ui-choice-tile-check" aria-hidden="true">
                {checked && <Check size={12} strokeWidth={3} />}
              </span>
            </label>
          );
        })}
        {!shown.length && <p className="ui-choice-grid-empty">Nothing matches “{filter}”.</p>}
      </div>
    </fieldset>
  );
}

export type FlowState = 'idle' | 'checking' | 'connected' | 'failed';

export interface FlowEndpoint {
  label: ReactNode;
  icon?: ReactNode;
}

const FLOW_SPOKEN: Record<FlowState, string> = {
  idle: 'not connected',
  checking: 'connecting',
  connected: 'connected',
  failed: 'could not connect',
};

/**
 * Two endpoints and the link between them. The link only ever shows real state the caller
 * passes: idle (a quiet dashed line), checking (a dot travelling across while a request is
 * in flight), connected (a solid line with a check) and failed (a broken line with a cross,
 * and the actual error under it). It never animates on its own.
 */
export function FlowDiagram({
  from,
  to,
  via,
  state,
  error,
  className,
}: {
  from: FlowEndpoint;
  to: FlowEndpoint;
  /** A short label on the link, such as "SSH". */
  via?: ReactNode;
  state: FlowState;
  /** The real error when the state is failed. */
  error?: ReactNode;
  className?: string;
}) {
  const statusId = useId();
  return (
    <figure className={cn('ui-flow', className)} data-state={state} aria-describedby={statusId}>
      <div className="ui-flow-row">
        <span className="ui-flow-node">
          {from.icon && (
            <span className="ui-flow-node-icon" aria-hidden="true">
              {from.icon}
            </span>
          )}
          <span className="ui-flow-node-label">{from.label}</span>
        </span>
        <span className="ui-flow-link" aria-hidden="true">
          <svg
            className="ui-flow-line"
            viewBox="0 0 100 8"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <title>Link</title>
            <line x1="0" y1="4" x2="100" y2="4" />
          </svg>
          {state === 'checking' && <span className="ui-flow-pulse" />}
          {(state === 'connected' || state === 'failed') && (
            <span className="ui-flow-badge">
              {state === 'connected' ? (
                <Check size={11} strokeWidth={3} />
              ) : (
                <X size={11} strokeWidth={3} />
              )}
            </span>
          )}
          {via && <span className="ui-flow-via">{via}</span>}
        </span>
        <span className="ui-flow-node">
          {to.icon && (
            <span className="ui-flow-node-icon" aria-hidden="true">
              {to.icon}
            </span>
          )}
          <span className="ui-flow-node-label">{to.label}</span>
        </span>
      </div>
      <figcaption id={statusId} className="ui-flow-status" role="status">
        <span className="ui-sr-only">{FLOW_SPOKEN[state]}</span>
        {state === 'failed' && error && <span className="ui-flow-error">{error}</span>}
      </figcaption>
    </figure>
  );
}

export type FieldCheckTone = 'ok' | 'pending' | 'error' | 'info';

/**
 * A live line under a field from a real check, such as the same format rule the other side
 * applies. Give the field `aria-describedby` with this id so the result is read with it.
 */
export function FieldCheck({
  id,
  tone,
  children,
  className,
}: {
  id?: string;
  tone: FieldCheckTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('ui-field-check', className)} data-tone={tone} aria-live="polite">
      {tone === 'ok' ? (
        <CircleCheck size={14} aria-hidden="true" />
      ) : tone === 'error' ? (
        <CircleAlert size={14} aria-hidden="true" />
      ) : (
        <span className="ui-field-check-dot" aria-hidden="true" />
      )}
      <span>{children}</span>
    </p>
  );
}

export interface SecretCheck {
  tone: FieldCheckTone;
  message: ReactNode;
}

/**
 * A secret such as an API key: masked with a Show/Hide toggle, never autocompleted or spell
 * checked, with an optional live format check from the caller shown as a FieldCheck. The
 * check only advises (providers change key formats); the real check is the connection itself.
 */
export function SecretField({
  label,
  value,
  onValueChange,
  check,
  description,
  placeholder,
  disabled,
  required,
  maxLength = 8192,
  id,
  className,
}: {
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  /** Reads a non-empty value; return nothing when there is nothing useful to say. */
  check?: (value: string) => SecretCheck | undefined;
  description?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  maxLength?: number;
  id?: string;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [shown, setShown] = useState(false);
  const result = value.trim() ? check?.(value) : undefined;
  const describedBy =
    [description ? `${inputId}-description` : '', result ? `${inputId}-check` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={cn('form-field ui-secret-field', className)}>
      <label htmlFor={inputId}>{label}</label>
      {description && (
        <p id={`${inputId}-description`} className="form-field-description">
          {description}
        </p>
      )}
      <div className="ui-secret-row">
        <input
          id={inputId}
          className="form-control ui-secret-input"
          type={shown ? 'text' : 'password'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          maxLength={maxLength}
          aria-describedby={describedBy}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={shown}
          aria-label={shown ? 'Hide key' : 'Show key'}
          disabled={disabled || !value}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? 'Hide' : 'Show'}
        </Button>
      </div>
      {result && (
        <FieldCheck id={`${inputId}-check`} tone={result.tone}>
          {result.message}
        </FieldCheck>
      )}
    </div>
  );
}

export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

/**
 * A compact editable list of name and value pairs (environment variables, headers) or of
 * single values (command arguments, with `valuesOnly`). Enter in a row's last field adds a
 * row and moves focus into it; each row has a labelled remove button.
 */
export function KeyValueList({
  label,
  rows,
  onRowsChange,
  valuesOnly = false,
  keyLabel = 'Name',
  valueLabel = 'Value',
  keyPlaceholder,
  valuePlaceholder,
  secretValues = false,
  addLabel,
  disabled,
  className,
}: {
  /** Names the list, such as "Environment variables"; rows are announced as "<label> 2". */
  label: string;
  rows: KeyValueRow[];
  onRowsChange: (rows: KeyValueRow[]) => void;
  valuesOnly?: boolean;
  keyLabel?: string;
  valueLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Masks values, for variables that hold credentials. */
  secretValues?: boolean;
  addLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const fields = useRef(new Map<string, HTMLInputElement>());
  const [focusRow, setFocusRow] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRow) return;
    fields.current.get(focusRow)?.focus();
    setFocusRow(null);
  }, [focusRow]);
  const add = () => {
    const id = crypto.randomUUID();
    onRowsChange([...rows, { id, key: '', value: '' }]);
    setFocusRow(id);
  };
  const change = (id: string, patch: Partial<KeyValueRow>) =>
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const addOnEnter = (event: React.KeyboardEvent<HTMLInputElement>, last: boolean) => {
    if (event.key !== 'Enter' || !last) return;
    event.preventDefault();
    add();
  };
  return (
    <fieldset
      className={cn('ui-kv-list', className)}
      data-values-only={valuesOnly || undefined}
      disabled={disabled}
    >
      <legend className="ui-kv-legend">{label}</legend>
      {rows.length > 0 && (
        <ul className="ui-kv-rows">
          {rows.map((row, index) => {
            const last = index === rows.length - 1;
            const name = `${label} ${index + 1}`;
            return (
              <li key={row.id} className="ui-kv-row">
                {!valuesOnly && (
                  <input
                    ref={(node) => {
                      if (node) fields.current.set(row.id, node);
                      else fields.current.delete(row.id);
                    }}
                    className="form-control ui-kv-key"
                    aria-label={`${name} ${keyLabel.toLowerCase()}`}
                    placeholder={keyPlaceholder}
                    spellCheck={false}
                    autoComplete="off"
                    value={row.key}
                    onChange={(event) => change(row.id, { key: event.target.value })}
                  />
                )}
                <input
                  ref={
                    valuesOnly
                      ? (node) => {
                          if (node) fields.current.set(row.id, node);
                          else fields.current.delete(row.id);
                        }
                      : undefined
                  }
                  className="form-control ui-kv-value"
                  aria-label={valuesOnly ? name : `${name} ${valueLabel.toLowerCase()}`}
                  placeholder={valuePlaceholder}
                  type={secretValues ? 'password' : 'text'}
                  spellCheck={false}
                  autoComplete="off"
                  value={row.value}
                  onKeyDown={(event) => addOnEnter(event, last)}
                  onChange={(event) => change(row.id, { value: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ui-kv-remove"
                  aria-label={`Remove ${name}`}
                  onClick={() => {
                    const next = rows.filter((item) => item.id !== row.id);
                    onRowsChange(next);
                    const neighbour = next[Math.min(index, next.length - 1)];
                    if (neighbour) setFocusRow(neighbour.id);
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button type="button" variant="ghost" size="sm" className="ui-kv-add" onClick={add}>
        {addLabel}
      </Button>
    </fieldset>
  );
}

export interface SetupListItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** A short state, such as "Connected" or "Not reachable", shown beside the title. */
  status?: ReactNode;
  actions?: ReactNode;
}

/**
 * What an ongoing connection screen manages, listed compactly first, with the action that
 * opens the guided flow to add another below it, rather than a permanent form.
 */
export function SetupList({
  label,
  items,
  empty,
  action,
  className,
}: {
  label: string;
  items: SetupListItem[];
  /** Shown when there is nothing yet, such as "No services connected yet." */
  empty?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('ui-setup-list', className)} aria-label={label}>
      {items.length > 0 ? (
        <ul className="ui-setup-list-items">
          {items.map((item) => (
            <li key={item.id} className="ui-setup-list-item">
              {item.icon && (
                <span className="ui-setup-list-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="ui-setup-list-text">
                <span className="ui-setup-list-title">
                  {item.title}
                  {item.status && <span className="ui-setup-list-status">{item.status}</span>}
                </span>
                {item.description && (
                  <span className="ui-setup-list-description">{item.description}</span>
                )}
              </span>
              {item.actions && <span className="ui-setup-list-actions">{item.actions}</span>}
            </li>
          ))}
        </ul>
      ) : (
        empty && <p className="ui-setup-list-empty">{empty}</p>
      )}
      {action && <div className="ui-setup-list-action">{action}</div>}
    </section>
  );
}
