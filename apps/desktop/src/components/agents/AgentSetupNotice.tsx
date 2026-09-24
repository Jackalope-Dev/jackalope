import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

/** Whether an error means no agent could answer, as opposed to a problem with the request. */
export function isAgentSetupError(message: string) {
  return /^No (installed )?agent (can|could)/.test(message);
}

/**
 * The shared failure for text Jackalope asks an agent to write (Ask Jackalope,
 * commit messages): what was tried, and one clear way to fix it.
 */
export function AgentSetupNotice({
  message,
  onNavigate,
}: {
  message: string;
  onNavigate?: () => void;
}) {
  return (
    <InlineNotice tone="error" className="agent-setup-notice">
      <span style={{ display: 'block', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
        {message}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() => {
          onNavigate?.();
          navigateWorkspace('agents');
        }}
      >
        Set up agents
      </Button>
    </InlineNotice>
  );
}
