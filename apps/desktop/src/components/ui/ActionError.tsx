import { InlineNotice } from '@jackalope/ui';

export function ActionError({ error }: { error?: string | null }) {
  return error ? <InlineNotice tone="error">{error}</InlineNotice> : null;
}
