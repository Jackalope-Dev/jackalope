import { Button } from '@jackalope/ui';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { workSource } from '../../lib/issues';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';

export function WorkSourceLink({ prompts }: { prompts: string[] }) {
  const source = prompts.map(workSource).find(Boolean);
  const [error, setError] = useState('');
  if (!source) return null;
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => void openExternalUrl(source).catch((cause) => setError(String(cause)))}
      >
        <ExternalLink size={15} aria-hidden="true" />
        Linked work
      </Button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </>
  );
}
