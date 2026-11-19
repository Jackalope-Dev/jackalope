import { InlineNotice } from '@jackalope/ui';
import './action-error.css';

export function ActionError({ error }: { error?: string | null }) {
  return error ? (
    <InlineNotice tone="error" className="action-error">
      {error}
    </InlineNotice>
  ) : null;
}
