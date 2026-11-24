import type { RefObject } from 'react';
import { useKeybindingHandlers } from '../../hooks/useKeybindings';

/**
 * A composer's keyboard actions. Each composer form carries `data-composer`; the actions
 * act on the focused composer, or the one used last. Leave an action out where the
 * composer lacks it, and return false when it cannot run right now.
 */
export function useComposerKeybindings(
  form: RefObject<HTMLFormElement | null>,
  actions: {
    focus: () => void;
    send: () => void;
    agentPicker?: () => boolean | undefined;
    effortPicker?: () => boolean | undefined;
    planMode?: () => boolean | undefined;
  },
) {
  useKeybindingHandlers(
    {
      focusComposer: actions.focus,
      send: actions.send,
      agentPicker: actions.agentPicker,
      effortPicker: actions.effortPicker,
      planMode: actions.planMode,
    },
    form,
  );
}
