import { Input } from '@jackalope/ui';
import { useId, useState } from 'react';
import { Button } from '../ui/button';

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
    if (!value.trim() || values.length >= 12 || values.includes(value.trim())) return;
    setRowIds([...rowIds, crypto.randomUUID()]);
    onChange([...values, value.trim()]);
    setValue('');
  };
  return (
    <fieldset className="my-4 space-y-2 outcome-editor">
      <legend className="font-medium">{label}</legend>
      {values.map((text, index) => (
        <div key={rowIds[index] ?? text} className="flex gap-2 items-start">
          <Input
            aria-label={`${label} ${index + 1}`}
            className="task-input flex-1 min-w-0"
            value={text}
            maxLength={500}
            onChange={(e) => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
          />
          <Button
            type="button"
            variant="ghost"
            aria-label={`Remove ${text}`}
            onClick={() => {
              setRowIds(rowIds.filter((_, i) => i !== index));
              onChange(values.filter((_, i) => i !== index));
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      {values.length < 12 && (
        <div className="flex gap-2">
          <Input
            id={id}
            aria-label={`Add: ${label}`}
            className="task-input flex-1 min-w-0"
            value={value}
            maxLength={500}
            placeholder="Add one specific requirement"
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
