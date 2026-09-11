import { Check, CircleAlert, Clock3 } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Disclosure,
  DisclosureSummary,
  FeedbackIcon,
  FormField,
  InlineNotice,
  MailIcon,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  RefreshIcon,
  SearchField,
  SectionHeader,
  Select,
  SelectItem,
  SettingGroup,
  SettingRow,
  Switch,
} from '../src';

export function Patterns() {
  const [query, setQuery] = useState('');
  const [locked, setLocked] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [newsletter, setNewsletter] = useState(true);
  const [frequency, setFrequency] = useState('weekly');
  const [saving, setSaving] = useState(false);
  const [fail, setFail] = useState(false);
  const [saveCount, setSaveCount] = useState(0);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [toggles, setToggles] = useState(0);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setSaving(true);
    setError('');
    pending.current = setTimeout(() => {
      pending.current = null;
      setSaving(false);
      if (fail) setError('The example could not save. Try again.');
      else setSaveCount((count) => count + 1);
    }, 650);
  }
  return (
    <section className="gallery-section" id="patterns" aria-labelledby="patterns-title">
      <SectionHeader
        title="Familiar patterns, shared everywhere"
        titleId="patterns-title"
        description="Search, settings, expandable details, and actions that fit together."
      />
      <div className="gallery-patterns">
        <Panel aria-labelledby="search-pattern-title">
          <PanelHeader>
            <h3 id="search-pattern-title">Find your work</h3>
          </PanelHeader>
          <PanelBody>
            <form
              className="gallery-form"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(String(new FormData(event.currentTarget).get('query') ?? ''));
              }}
              onReset={() => {
                setQuery('');
                setSubmitted('');
              }}
            >
              <FormField
                label="Search the example workspace"
                description="Find a project, task, or person."
              >
                <SearchField
                  ref={search}
                  name="query"
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search your workspace…"
                  clearLabel="Clear workspace search"
                  readOnly={locked}
                  disabled={disabled}
                  maxLength={80}
                  required
                />
              </FormField>
              <div className="gallery-row">
                <Button type="submit" variant="secondary">
                  Run search
                </Button>
                <Button type="reset" variant="ghost">
                  Reset search
                </Button>
                <Button type="button" variant="ghost" onClick={() => search.current?.focus()}>
                  Focus search
                </Button>
              </div>
              <output aria-label="Search submission">
                {submitted || 'Your search stays in this gallery.'}
              </output>
            </form>
            <div className="gallery-row gallery-pattern-options">
              <label className="gallery-check">
                <Checkbox checked={locked} onChange={(event) => setLocked(event.target.checked)} />
                Read-only search
              </label>
              <label className="gallery-check">
                <Checkbox
                  checked={disabled}
                  onChange={(event) => setDisabled(event.target.checked)}
                />
                Disable search
              </label>
            </div>
          </PanelBody>
        </Panel>
        <Panel as="article" aria-labelledby="settings-pattern-title">
          <PanelHeader>
            <h3 id="settings-pattern-title">Workspace preferences</h3>
            <Badge variant="success" icon={Check}>
              Ready
            </Badge>
          </PanelHeader>
          <form onSubmit={save}>
            <PanelBody>
              <SettingGroup>
                <SettingRow
                  title="Product updates"
                  description="Receive occasional news about your workspace."
                  controlId="gallery-newsletter"
                  descriptionId="gallery-newsletter-description"
                >
                  <Switch
                    id="gallery-newsletter"
                    label="Product updates"
                    aria-describedby="gallery-newsletter-description"
                    checked={newsletter}
                    onCheckedChange={setNewsletter}
                    disabled={saving}
                  />
                </SettingRow>
                <SettingRow title="Digest frequency" controlId="gallery-digest">
                  <Select
                    id="gallery-digest"
                    value={frequency}
                    onValueChange={setFrequency}
                    disabled={saving}
                  >
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </Select>
                </SettingRow>
              </SettingGroup>
              <label className="gallery-check gallery-pattern-options">
                <Checkbox
                  checked={fail}
                  onChange={(event) => setFail(event.target.checked)}
                  disabled={saving}
                />
                Simulate save failure
              </label>
              {error && <InlineNotice tone="error">{error}</InlineNotice>}
              <p role="status">
                {saving ? 'Saving example preferences…' : `${saveCount} example saves completed.`}
              </p>
            </PanelBody>
            <PanelFooter>
              <Button type="submit" loading={saving} loadingLabel="Saving preferences…">
                Save preferences
              </Button>
            </PanelFooter>
          </form>
        </Panel>
      </div>
      <Panel variant="plain" aria-label="Expandable details examples">
        <Disclosure
          onToggle={(event) => {
            setOpen(event.currentTarget.open);
            setToggles((count) => count + 1);
          }}
        >
          <DisclosureSummary>How are these controls shared?</DisclosureSummary>
          <p>Desktop, website, and admin use the same controls with their own data and actions.</p>
          <Disclosure>
            <DisclosureSummary>Can sections be nested?</DisclosureSummary>
            <p>Each section opens independently and works with the keyboard.</p>
          </Disclosure>
        </Disclosure>
        <Disclosure open>
          <DisclosureSummary>What happens when an action fails?</DisclosureSummary>
          <p>Show the error beside the action and make it possible to retry.</p>
        </Disclosure>
        <output aria-label="Disclosure changes">
          {open ? 'Open' : 'Closed'} · {toggles} changes
        </output>
      </Panel>
      <section className="gallery-row" aria-label="Shared status styles">
        <Badge icon={Clock3}>In progress</Badge>
        <Badge variant="success" icon={Check}>
          Ready for review
        </Badge>
        <Badge variant="danger" icon={CircleAlert}>
          Needs attention
        </Badge>
        <Badge appearance="plain" icon={Clock3}>
          Waiting for a response
        </Badge>
      </section>
      <section className="gallery-row" aria-label="Shared action icon sizes">
        {([16, 20, 24] as const).map((size) => (
          <div className="gallery-icon-set" key={size}>
            <RefreshIcon size={size} />
            <FeedbackIcon size={size} />
            <MailIcon size={size} aria-label={`Mail icon at ${size}px`} />
            <span>{size}px</span>
          </div>
        ))}
      </section>
    </section>
  );
}
