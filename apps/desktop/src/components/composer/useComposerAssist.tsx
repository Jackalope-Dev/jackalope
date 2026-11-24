import {
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useProjectFiles } from '../../hooks/useProjectFiles';
import {
  type ComposerCommand,
  type ComposerCommandContext,
  composerCommands,
  insertMention,
  matchCommands,
  mentionQuery,
  parseCommand,
  slashQuery,
} from '../../lib/composer-commands';
import { searchFiles } from '../../lib/file-search';
import { isTauriEnvironment } from '../../lib/native/env';
import { appendAttachments, attachmentReference } from '../../lib/prompt-attachments';
import {
  caretAtEdge,
  type HistoryBrowse,
  historyEntries,
  stepHistory,
} from '../../lib/prompt-history';
import { useHostContextStore } from '../../stores/hostContextStore';
import { ComposerMenu, type ComposerMenuOption } from './ComposerMenu';

/**
 * Slash commands, `@` file mentions and prompt history for one composer textarea.
 * The composer spreads `fieldProps` on its textarea, calls `onKeyDown` first in its own
 * key handler, renders `menu` inside its (relatively positioned) form, and lets
 * `intercept` see a draft before sending so commands the composer runs never reach
 * the agent. Anything else starting with `/` is sent unchanged.
 */
export function useComposerAssist({
  input,
  text,
  setText,
  projectPath,
  history,
  commands,
  run,
  disabled,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: (value: string) => void;
  /** Mentions list this project's files; without it, `@` is plain text. */
  projectPath?: string;
  /** Earlier prompts for this task or conversation, oldest first. */
  history: readonly string[];
  commands: ComposerCommandContext;
  /** Runs a command the composer handles itself. */
  run: (command: ComposerCommand, argument: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const browse = useRef<HistoryBrowse | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const remoteHost = useHostContextStore((state) => state.host);
  const entries = useMemo(() => historyEntries(history), [history]);
  // A sent prompt joins the history; browsing starts over from the new end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets only when the history changes
  useEffect(() => {
    browse.current = null;
  }, [entries]);
  const list = useMemo(() => composerCommands(commands), [commands]);
  const slash = disabled ? null : slashQuery(text, caret);
  const mention =
    disabled || slash !== null || !projectPath || remoteHost || !isTauriEnvironment()
      ? null
      : mentionQuery(text, caret);
  const files = useProjectFiles(projectPath, !!mention);
  const options: ComposerMenuOption[] =
    slash !== null
      ? matchCommands(list, slash).map((command) => ({
          id: `command-${command.name}`,
          label: `/${command.name}`,
          argument: command.argument,
          detail:
            command.id === 'provider' ? `Skill · ${command.description}` : command.description,
          command,
        }))
      : mention?.query
        ? searchFiles(files, mention.query, 8).map((path) => ({
            id: `file-${path}`,
            label: path,
            file: path,
          }))
        : [];
  const key = slash !== null ? `/${slash}` : mention ? `@${mention.start}:${mention.query}` : null;
  const hint =
    mention && !options.length ? (mention.query ? 'No matching files' : 'Type a file name') : '';
  const open = !!key && key !== dismissed && (options.length > 0 || !!hint);
  // Escape closes the menu until the draft leaves that command or mention.
  useEffect(() => {
    if (!key) setDismissed(null);
  }, [key]);
  const highlighted = Math.min(active, Math.max(options.length - 1, 0));

  useEffect(() => {
    if (pendingCaret.current === null || !input.current) return;
    const position = pendingCaret.current;
    pendingCaret.current = null;
    input.current.setSelectionRange(position, position);
    setCaret(position);
  });

  const replace = (value: string, position = value.length) => {
    pendingCaret.current = position;
    setText(value);
    input.current?.focus();
  };

  const choose = (option: ComposerMenuOption) => {
    setActive(0);
    if (option.command) {
      const { command } = option;
      if (command.argument || command.id === 'provider') {
        replace(`/${command.name} `);
        return;
      }
      replace('');
      run(command, '');
      return;
    }
    if (option.file && mention && projectPath) {
      const inserted = insertMention(text, mention.start, caret, option.file);
      const reference = attachmentReference(`${projectPath}/${option.file}`, projectPath);
      const next = appendAttachments(inserted.text, [reference]);
      // Appending the attachment line can trim the space after a mention at the end.
      const end = inserted.caret - 1;
      replace(next, next[end] === ' ' ? end + 1 : end);
    }
  };

  const track = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(event.currentTarget.selectionStart);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey)
      return false;
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (options.length)
          setActive(
            (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length,
          );
        return true;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        const option = options[highlighted];
        if (!option) return false;
        event.preventDefault();
        choose(option);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(key);
        return true;
      }
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) {
      const field = event.currentTarget;
      const direction = event.key === 'ArrowUp' ? 'up' : 'down';
      if (!caretAtEdge(field.value, field.selectionStart, field.selectionEnd, direction))
        return false;
      const step = stepHistory(entries, browse.current, field.value, direction);
      if (!step) return false;
      event.preventDefault();
      browse.current = step.browse;
      replace(step.text, direction === 'up' ? 0 : step.text.length);
      return true;
    }
    return false;
  };

  /** Runs a command the composer handles; true when the draft should not be sent. */
  const intercept = (draft: string): boolean => {
    const parsed = parseCommand(draft);
    if (!parsed) return false;
    const command = list.find((item) => item.name === parsed.name && item.id !== 'provider');
    if (!command) return false;
    if (command.argument && !parsed.argument) {
      replace(`/${command.name} `);
      return true;
    }
    replace('');
    run(command, parsed.argument);
    return true;
  };

  return {
    onKeyDown,
    intercept,
    /** Call after a send so ArrowUp starts from the newest prompt. */
    sent: () => {
      browse.current = null;
    },
    fieldProps: {
      onSelect: track,
      onClick: track,
      'aria-autocomplete': 'list' as const,
      'aria-expanded': open,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant':
        open && options[highlighted] ? `${listId}-${options[highlighted].id}` : undefined,
    },
    menu: open ? (
      <ComposerMenu
        id={listId}
        label={slash !== null ? 'Commands' : 'Files'}
        options={options}
        active={highlighted}
        hint={hint}
        onHover={setActive}
        onChoose={choose}
      />
    ) : null,
  };
}
