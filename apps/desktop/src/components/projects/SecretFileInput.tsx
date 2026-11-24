import { Button, FormField, LinkButton, Textarea } from '@jackalope/ui';
import { FileUp } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { fileSecretError, type SecretFileValue, safeFileName } from '../../lib/secret-file';

/**
 * A secret file, picked from disk or pasted. A picked file's contents are never shown;
 * only its name is, with a way to clear it and paste instead.
 */
export function SecretFileInput({
  label,
  description,
  accept,
  placeholder = '-----BEGIN PRIVATE KEY-----',
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  accept?: string;
  placeholder?: string;
  value: SecretFileValue | null;
  onChange: (value: SecretFileValue | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const problem = fileSecretError(text);
      if (problem) {
        setError(problem);
        return;
      }
      onChange({ text, fileName: safeFileName(file.name) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (picker.current) picker.current.value = '';
    }
  };
  const picked = value?.fileName;
  return (
    <div className="secret-file-input">
      <input
        ref={picker}
        type="file"
        accept={accept}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      {picked ? (
        <div className="form-field">
          <span className="secret-file-label">{label}</span>
          <p className="secret-file-chosen">
            <code>{picked}</code>
            <LinkButton
              disabled={disabled}
              onClick={() => {
                setError('');
                onChange(null);
              }}
            >
              Clear
            </LinkButton>
          </p>
        </div>
      ) : (
        <FormField
          label={label}
          description={description ?? 'Choose the file, or paste its contents.'}
          error={error || undefined}
        >
          <Textarea
            id={`${id}-text`}
            rows={4}
            spellCheck={false}
            autoComplete="off"
            className="secret-file-text"
            placeholder={placeholder}
            disabled={disabled}
            value={value?.text ?? ''}
            onChange={(event) => {
              setError('');
              const text = event.target.value;
              onChange(text ? { text, fileName: null } : null);
            }}
          />
        </FormField>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => picker.current?.click()}
        >
          <FileUp size={16} aria-hidden="true" />
          {picked ? 'Choose another file…' : 'Choose file…'}
        </Button>
      </div>
    </div>
  );
}
