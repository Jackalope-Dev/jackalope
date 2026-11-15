import { FlowDiagram, type FlowState, SecretField } from '@jackalope/ui';
import { KeyRound, Laptop } from 'lucide-react';
import type { ReactNode } from 'react';
import { apiKeyAdvice } from '../../lib/api-key-format';
import { ProviderMark } from './ProviderMark';
import './credential-step.css';

/** Provider ids from api-providers mapped to the agent marks that carry their brand. */
const PROVIDER_MARK: Record<string, string> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
  xai: 'grok',
  deepseek: 'deepseek',
  openrouter: 'openrouter',
};

export function providerMarkFor(providerId: string, size = 18): ReactNode {
  const mark = PROVIDER_MARK[providerId];
  return mark ? <ProviderMark provider={mark} size={size} /> : <KeyRound size={size} />;
}

/**
 * Connecting with an API key, shared by agent accounts, provider connections and routing:
 * the link from this computer to the provider shows only the real state the caller passes
 * (idle, checking while a save or check runs, connected once it succeeded, failed with the
 * error it passes), and the key field advises on its format without blocking it.
 */
export function CredentialStep({
  providerName,
  providerIcon,
  envKey,
  value,
  onValueChange,
  state,
  error,
  disabled,
  label = 'API key',
  description = 'Kept in protected local storage on this computer and sent only to authenticate.',
  placeholder = 'Paste your API key',
}: {
  providerName: ReactNode;
  providerIcon?: ReactNode;
  /** The provider's key variable, such as ANTHROPIC_API_KEY, for format advice. */
  envKey?: string;
  value: string;
  onValueChange: (value: string) => void;
  state: FlowState;
  /** The real failure, shown on the link when the state is failed. */
  error?: ReactNode;
  disabled?: boolean;
  label?: ReactNode;
  description?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="credential-step">
      <FlowDiagram
        from={{ label: 'This computer', icon: <Laptop size={16} /> }}
        to={{ label: providerName, icon: providerIcon ?? <KeyRound size={16} /> }}
        via="API key"
        state={state}
        error={error}
      />
      <SecretField
        label={label}
        description={description}
        value={value}
        onValueChange={onValueChange}
        check={(key) => apiKeyAdvice(envKey, key)}
        placeholder={placeholder}
        disabled={disabled}
        required
      />
    </div>
  );
}
