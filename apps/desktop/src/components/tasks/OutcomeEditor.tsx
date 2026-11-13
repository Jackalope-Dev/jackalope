import { Button, IconButton, Input } from '@jackalope/ui';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import './outcome-editor.css';

const MAX = 12;

/** A short list of specific lines (outcomes, inputs or steps), numbered in the order saved. */
export function OutcomeEditor({
  label = 'What should be true when this is done?',
  values,
  onChange,
}: {
  label?: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  const [rowIds, setRowIds] = useState(() => values.map(() => crypto.randomUUID()));
  const add = () => {
    if (!value.trim() || values.length >= MAX || values.includes(value.trim())) return;
    setRowIds([...rowIds, crypto.randomUUID()]);
    onChange([...values, value.trim()]);
    setValue('');
  };
  return (
    <fieldset className="outcome-editor">
      <legend>
        {label}
        <span className="outcome-editor-count">
          {values.length} of {MAX}
        </span>
      </legend>
      {values.length > 0 && (
        <ol className="outcome-editor-rows">
          {values.map((text, index) => (
            <li key={rowIds[index] ?? text}>
              <span className="outcome-editor-number" aria-hidden="true">
                {index + 1}
              </span>
              <Input
                aria-label={`${label} ${index + 1}`}
                value={text}
                maxLength={500}
                onChange={(e) => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
              />
              <IconButton
                label={`Remove ${text}`}
                onClick={() => {
                  setRowIds(rowIds.filter((_, i) => i !== index));
                  onChange(values.filter((_, i) => i !== index));
                }}
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
      {values.length < MAX && (
        <div className="outcome-editor-add">
          <Input
            id={id}
            aria-label={`Add: ${label}`}
            value={value}
            maxLength={500}
            placeholder="Add one specific line, then press Enter"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!value.trim() || values.includes(value.trim())}
            onClick={add}
          >
            Add
          </Button>
        </div>
      )}
    </fieldset>
  );
}
