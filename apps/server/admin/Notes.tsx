import { Button, Checkbox, FormField, Input, Panel, Textarea } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import { type Broadcast, message, post, useResource } from './api';
import { ErrorNotice, Heading, Refresh, SelectField } from './components';

const initialNote = {
  subject: '',
  preview: '',
  headline: '',
  intro: '',
  outro: '',
  tag: '',
  actionLabel: '',
  actionUrl: '',
  entries: [] as string[],
  extras: [] as { id: string; title: string; body: string }[],
};
export function Notes() {
  const request = useResource<Broadcast>('/admin/api/access/broadcast');
  const [note, setNote] = useState(initialNote);
  const [saved, setSaved] = useState(JSON.stringify(initialNote));
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const addSection = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url?: string } | null>(null);
  const dirty = JSON.stringify(note) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function draft() {
    return {
      subject: note.subject.trim(),
      preview: note.preview.trim(),
      headline: note.headline.trim(),
      intro: note.intro.trim(),
      outro: note.outro.trim(),
      tag: note.tag,
      entries: note.entries,
      extras: note.extras
        .map((extra) => ({ title: extra.title.trim(), body: extra.body.trim() }))
        .filter((extra) => extra.title || extra.body),
      action: note.actionUrl.trim()
        ? { label: note.actionLabel.trim() || 'Read more', url: note.actionUrl.trim() }
        : null,
    };
  }
  function validate() {
    const value = draft();
    if (value.subject.length < 3) return 'Give the note a subject before previewing it.';
    if (value.headline.length < 3) return 'Give the note a headline before previewing it.';
    if (!value.entries.length && !value.extras.length && !value.intro)
      return 'Choose at least one change, or write an opening.';
    if (value.action && !/^https:\/\//.test(value.action.url))
      return 'The button link must be an https:// URL.';
    if (
      request.data &&
      note.entries.some((id) => !request.data?.entries.some((entry) => entry.id === id))
    )
      return 'A selected change is no longer published. Remove unavailable changes before continuing.';
    return '';
  }
  function preview() {
    const problem = validate();
    setError(problem);
    if (problem) return;
    const value = draft();
    const params = new URLSearchParams({
      subject: value.subject,
      preview: value.preview,
      headline: value.headline,
      intro: value.intro,
      outro: value.outro,
      tag: value.tag,
    });
    for (const id of value.entries) params.append('entry', id);
    for (const extra of value.extras) params.append('extra', `${extra.title}\n${extra.body}`);
    if (value.action) {
      params.set('actionLabel', value.action.label);
      params.set('actionUrl', value.action.url);
    }
    window.open(`/admin/access/broadcast-preview?${params}`, '_blank', 'noreferrer');
  }
  async function createDraft() {
    if (sending.current || !request.data?.configured) return;
    const problem = validate();
    setError(problem);
    if (problem) return;
    sending.current = true;
    setBusy(true);
    setResult(null);
    const snapshot = JSON.stringify(note);
    try {
      setResult(await post('/admin/api/access/broadcast', draft()));
      setSaved(snapshot);
    } catch (error) {
      setError(message(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const field = (
    key: 'subject' | 'preview' | 'headline' | 'intro' | 'outro' | 'actionLabel' | 'actionUrl',
    label: string,
    maxLength: number,
    placeholder: string,
    multiline = false,
  ) => (
    <FormField label={label}>
      <InputOrTextarea
        multiline={multiline}
        value={note[key]}
        onChange={(value) => setNote((note) => ({ ...note, [key]: value }))}
        disabled={busy}
        maxLength={maxLength}
        placeholder={placeholder}
        type={key === 'actionUrl' ? 'url' : 'text'}
      />
    </FormField>
  );
  return (
    <>
      <Heading
        title="Product notes"
        eyebrow="Communication"
        action={
          <Refresh loading={request.loading || busy} onClick={request.reload}>
            Reload changes
          </Refresh>
        }
      >
        Turn published changes into a thoughtful update for your audience.
      </Heading>
      <Panel className="panel">
        <h2>Compose an update</h2>
        <p role="status">
          {request.loading
            ? 'Loading published changes…'
            : request.data
              ? `${request.data.entries.length} published changes to choose from`
              : 'Changes could not be loaded. Reload changes to try again.'}
        </p>
        <ErrorNotice>{request.error}</ErrorNotice>
        <div className="compose">
          {field('subject', 'Subject', 150, 'What shipped in Jackalope this month')}
          {field('preview', 'Preview text', 150, 'Shown after the subject in the inbox')}
          {field('headline', 'Headline', 120, 'A few things worth knowing.')}
          {field(
            'intro',
            'Opening',
            1200,
            'Your own words. Blank lines start a new paragraph.',
            true,
          )}
          <h3 id="entries-heading">Include these changes</h3>
          <p>Straight from the published changelog. Nothing is included until you tick it.</p>
          <fieldset className="entries" aria-labelledby="entries-heading">
            {request.data?.entries.map((entry) => (
              <label className="entry" key={entry.id}>
                <Checkbox
                  disabled={busy}
                  checked={note.entries.includes(entry.id)}
                  onChange={(event) =>
                    setNote((note) => ({
                      ...note,
                      entries: event.target.checked
                        ? [...note.entries, entry.id]
                        : note.entries.filter((id) => id !== entry.id),
                    }))
                  }
                />
                <span>
                  <strong>{entry.title}</strong>
                  <small>
                    {entry.date}
                    {entry.status ? ` · ${entry.status}` : ''}
                  </small>
                  <small>{entry.description}</small>
                </span>
              </label>
            ))}
            {request.data && !request.data.entries.length && (
              <p className="empty">No published changes yet.</p>
            )}
          </fieldset>
          {request.data &&
            note.entries.some((id) => !request.data?.entries.some((entry) => entry.id === id)) && (
              <Button
                variant="secondary"
                onClick={() =>
                  setNote((note) => ({
                    ...note,
                    entries: note.entries.filter((id) =>
                      request.data?.entries.some((entry) => entry.id === id),
                    ),
                  }))
                }
              >
                Remove unavailable changes
              </Button>
            )}
          <h3>Add something of your own</h3>
          {note.extras.map((extra, index) => (
            <div className="extra" key={extra.id}>
              <FormField label={`Section ${index + 1} title`}>
                <Input
                  ref={(input) => {
                    if (input && pendingFocus.current === extra.id) {
                      input.focus();
                      pendingFocus.current = null;
                    }
                  }}
                  maxLength={200}
                  value={extra.title}
                  disabled={busy}
                  onChange={(event) =>
                    setNote((note) => ({
                      ...note,
                      extras: note.extras.map((row) =>
                        row.id === extra.id ? { ...row, title: event.target.value } : row,
                      ),
                    }))
                  }
                />
              </FormField>
              <FormField label={`Section ${index + 1} text`}>
                <Textarea
                  rows={3}
                  maxLength={800}
                  value={extra.body}
                  disabled={busy}
                  onChange={(event) =>
                    setNote((note) => ({
                      ...note,
                      extras: note.extras.map((row) =>
                        row.id === extra.id ? { ...row, body: event.target.value } : row,
                      ),
                    }))
                  }
                />
              </FormField>
              <div className="actions">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setNote((note) => ({
                      ...note,
                      extras: note.extras.filter((row) => row.id !== extra.id),
                    }));
                    addSection.current?.focus();
                  }}
                >
                  Remove section {index + 1}
                </Button>
              </div>
            </div>
          ))}
          <div className="actions">
            <Button
              variant="secondary"
              disabled={busy}
              ref={addSection}
              onClick={() => {
                const id = crypto.randomUUID();
                pendingFocus.current = id;
                setNote((note) => ({
                  ...note,
                  extras: [...note.extras, { id, title: '', body: '' }],
                }));
              }}
            >
              Add a section
            </Button>
          </div>
          {field('outro', 'Closing', 1200, 'Sign-off, an ask, or what is coming next.', true)}
          <div className="note-grid">
            {field('actionLabel', 'Button label', 60, 'Optional')}
            {field('actionUrl', 'Button link', 300, 'https://jackalope.dev/…')}
          </div>
          <SelectField
            label="Who receives it"
            value={note.tag}
            onChange={(tag) => setNote((note) => ({ ...note, tag }))}
            disabled={busy || request.loading}
            options={[
              ['', 'Everyone who opted into product notes'],
              ...[...new Set([...(request.data?.tags || []), ...(note.tag ? [note.tag] : [])])].map(
                (tag) => [tag, `Only ${tag.replace(/-/g, ' ')}`] as const,
              ),
            ]}
          />
          <p className="notice">
            {request.data
              ? request.data.configured
                ? `${request.data.synced} people are synced to the audience and can receive this.`
                : 'Sequenzy, the audience list or the sender is not configured, so a draft cannot be created yet.'
              : ''}
          </p>
        </div>
        <ErrorNotice>{error}</ErrorNotice>
        <p role="status">
          {busy ? (
            'Creating the draft…'
          ) : result ? (
            <>
              Draft created in Sequenzy. Nothing has been sent.{' '}
              {result.url?.startsWith('https://') && (
                <a href={result.url} target="_blank" rel="noreferrer">
                  Open it to review and send
                </a>
              )}
            </>
          ) : (
            ''
          )}
        </p>
        <div className="actions">
          <Button variant="secondary" disabled={busy} onClick={preview}>
            Preview in a new tab
          </Button>
          <Button
            disabled={busy || request.loading || !request.data?.configured}
            loading={busy}
            loadingLabel="Creating draft…"
            onClick={() => void createDraft()}
          >
            Create draft in Sequenzy
          </Button>
        </div>
        <p className="privacy">
          Creating a draft never sends email. Review and send it in Sequenzy.
        </p>
      </Panel>
    </>
  );
}

function InputOrTextarea({
  multiline,
  value,
  onChange,
  ...props
}: {
  multiline: boolean;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  maxLength: number;
  placeholder: string;
  type: string;
  id?: string;
}) {
  if (multiline) {
    const { type: _type, ...textareaProps } = props;
    return (
      <Textarea
        {...textareaProps}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return <Input {...props} value={value} onChange={(event) => onChange(event.target.value)} />;
}
