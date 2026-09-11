import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, type ButtonProps } from './Button';
import { InlineNotice } from './InlineNotice';
export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  errorMessage = 'Could not copy. Select the text to copy it manually.',
  onCopied,
  resetAfterMs = 2500,
  copy = (value) => navigator.clipboard.writeText(value),
  ...props
}: Omit<ButtonProps, 'children' | 'onClick'> & {
  text: string;
  label?: string;
  copiedLabel?: string;
  errorMessage?: string;
  onCopied?: () => void;
  resetAfterMs?: number;
  copy?: (value: string) => Promise<void>;
}) {
  const [state, setState] = useState<{ text: string; status: 'copied' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const latestText = useRef(text);
  latestText.current = text;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setState((current) => (current?.text === text ? current : null));
  }, [text]);
  useEffect(() => {
    if (state?.status !== 'copied' || resetAfterMs <= 0) return;
    const timer = setTimeout(() => setState(null), resetAfterMs);
    return () => clearTimeout(timer);
  }, [state, resetAfterMs]);
  const copied = state?.text === text && state.status === 'copied';
  async function handleCopy() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setState(null);
    try {
      await copy(text);
      if (mounted.current && latestText.current === text) {
        setState({ text, status: 'copied' });
        onCopied?.();
      }
    } catch {
      if (mounted.current && latestText.current === text) setState({ text, status: 'error' });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        {...props}
        disabled={busy || props.disabled}
        loading={busy || props.loading}
        loadingLabel={props.loadingLabel ?? 'Copying…'}
        onClick={() => void handleCopy()}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span aria-live="polite">{copied ? copiedLabel : label}</span>
      </Button>
      {state?.text === text && state.status === 'error' && (
        <InlineNotice tone="error">{errorMessage}</InlineNotice>
      )}
    </>
  );
}
