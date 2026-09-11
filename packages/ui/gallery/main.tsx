import { characterMarkViewBox, characterPaths } from '@jackalope/brand/character';
import { EchoMark } from '@jackalope/brand/echo';
import { applyThemeTokens, DEFAULT_THEME } from '@jackalope/brand/theme';
import { Check, ChevronDown, Inbox, MoreHorizontal, Plus, Settings } from 'lucide-react';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  DefinitionList,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTrigger,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  InlineNotice,
  Input,
  LoadingState,
  DropdownMenu as Menu,
  PageHeader,
  Popover,
  SectionHeader,
  SegmentedControl,
  Select,
  SelectItem,
  Stat,
  Switch,
  Table,
  Tabs,
  Textarea,
  Toolbar,
  Tooltip,
} from '../src';
import '@jackalope/brand/fonts.css';
import './styles.css';

function Gallery() {
  const [dark, setDark] = useState(new URLSearchParams(location.search).has('dark'));
  const [enabled, setEnabled] = useState(true);
  const [choice, setChoice] = useState('weekly');
  const [filter, setFilter] = useState('all');
  const [menuNotice, setMenuNotice] = useState('');
  const [menuChecked, setMenuChecked] = useState(false);
  const [submitted, setSubmitted] = useState('');
  const [showError, setShowError] = useState(false);
  const [failAction, setFailAction] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [clipboardText, setClipboardText] = useState('A sample link');
  const [failCopy, setFailCopy] = useState(false);
  const [clipboard, setClipboard] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => applyThemeTokens({ ...DEFAULT_THEME, isDark: dark }), [dark]);
  return (
    <main className="gallery">
      <PageHeader
        eyebrow="Jackalope / Shared UI"
        title="One family of controls."
        description="The building blocks behind the desktop, website, and admin console."
        icon={<EchoMark animated={false} className="gallery-mark" />}
        action={
          <label className="gallery-check">
            <Switch label="Dark appearance" checked={dark} onCheckedChange={setDark} />
            Dark appearance
          </label>
        }
      />
      <InlineNotice>
        Interactive examples with sample data. Actions stay in this gallery.
      </InlineNotice>
      <nav className="gallery-nav" aria-label="Component sections">
        <a href="#controls">Controls</a>
        <a href="#forms">Forms</a>
        <a href="#overlays">Overlays</a>
        <a href="#navigation">Navigation</a>
        <a href="#feedback">Feedback</a>
        <a href="#data">Data</a>
      </nav>
      <section className="gallery-section" id="controls" aria-labelledby="controls-title">
        <SectionHeader
          title="Everyday controls"
          titleId="controls-title"
          description="Consistent sizing, clear focus, and useful disabled states."
        />
        <Toolbar>
          <div className="gallery-row">
            <Button>
              <Plus size={16} />
              Create project
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Unavailable</Button>
            <Tooltip content="Workspace settings">
              <IconButton label="Workspace settings">
                <Settings size={20} />
              </IconButton>
            </Tooltip>
          </div>
        </Toolbar>
        <div className="gallery-row">
          {(['default', 'accent', 'outline', 'success', 'warning', 'danger'] as const).map(
            (variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ),
          )}
        </div>
        <div className="gallery-row">
          <label className="gallery-check">
            <Checkbox defaultChecked />
            Selected
          </label>
          <label className="gallery-check">
            <Checkbox indeterminate />
            Mixed selection
          </label>
          <label className="gallery-check">
            <Checkbox disabled />
            Unavailable
          </label>
          <label className="gallery-check">
            <Switch
              label="Notifications"
              description="Receive updates in the app."
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            Notifications
          </label>
        </div>
      </section>
      <section className="gallery-section" id="forms" aria-labelledby="forms-title">
        <SectionHeader
          title="Forms that explain themselves"
          titleId="forms-title"
          description="Native form values and validation, with linked labels, hints, and errors."
          action={
            <Button variant="ghost" onClick={() => inputRef.current?.focus()}>
              Focus name
            </Button>
          }
        />
        <form
          className="gallery-form"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));
          }}
        >
          <FormField
            label="Project name"
            description="A name you will recognize later."
            error={showError ? 'Choose a different project name.' : undefined}
          >
            <Input name="name" ref={inputRef} required defaultValue="Garden studio" />
          </FormField>
          <FormField label="Email">
            <Input type="email" name="email" required defaultValue="hello@example.invalid" />
          </FormField>
          <FormField label="Summary">
            <Textarea name="summary" defaultValue="A little room for big ideas." rows={3} />
          </FormField>
          <FormField label="Digest frequency">
            <Select name="frequency" value={choice} onValueChange={setChoice}>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </Select>
          </FormField>
          <label className="gallery-check">
            <Checkbox name="accepted" value="yes" required />I reviewed the example
          </label>
          <div className="gallery-row">
            <Button type="submit">Save example</Button>
            <Button type="reset" variant="outline">
              Reset native fields
            </Button>
            <Button variant="ghost" type="button" onClick={() => setShowError(!showError)}>
              Toggle field error
            </Button>
          </div>
          <output aria-label="Submitted values" className="gallery-output">
            {submitted || 'Submit to inspect native form values.'}
          </output>
        </form>
      </section>
      <section className="gallery-section" id="overlays" aria-labelledby="overlays-title">
        <SectionHeader
          title="Overlays and actions"
          titleId="overlays-title"
          description="Keyboard navigation, focus return, and space to handle an action safely."
        />
        <div className="gallery-row">
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline">
                Project actions
                <ChevronDown size={16} />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.Label>Project</Menu.Label>
                <Menu.Item onSelect={() => setMenuNotice('Project opened')}>
                  <Inbox size={16} />
                  Open project
                </Menu.Item>
                <Menu.Item disabled>Archive unavailable</Menu.Item>
                <Menu.Separator />
                <Menu.CheckboxItem checked={menuChecked} onCheckedChange={setMenuChecked}>
                  <Menu.ItemIndicator>
                    <Check size={16} />
                  </Menu.ItemIndicator>
                  Show archived
                </Menu.CheckboxItem>
                <Menu.Sub>
                  <Menu.SubTrigger>
                    More
                    <MoreHorizontal size={16} />
                  </Menu.SubTrigger>
                  <Menu.Portal>
                    <Menu.SubContent>
                      <Menu.Item onSelect={() => setMenuNotice('Project duplicated')}>
                        Duplicate
                      </Menu.Item>
                    </Menu.SubContent>
                  </Menu.Portal>
                </Menu.Sub>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button variant="outline">View options</Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content aria-label="View options" className="gallery-popover">
                <SectionHeader level={3} title="View options" />
                <label className="gallery-check">
                  <Checkbox defaultChecked />
                  Show descriptions
                </label>
                <Popover.Close asChild>
                  <Button variant="secondary">Done</Button>
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader
                title="Project details"
                description="A portable dialog, ready for your own content."
              />
              <DialogCloseButton />
              <FormField label="Dialog project name">
                <Input defaultValue="Garden studio" />
              </FormField>
            </DialogContent>
          </Dialog>
          <ConfirmDialog
            title="Remove this example?"
            description="This only changes the sample counter in the gallery."
            label="Remove example"
            busyLabel="Removing…"
            trigger={<Button variant="danger">Try confirmation</Button>}
            onConfirm={async () => {
              setAttempts((value) => value + 1);
              await new Promise((resolve) => setTimeout(resolve, 700));
              if (failAction) throw new Error('Example action failed. Try again.');
              setCompleted((value) => value + 1);
            }}
          />
          <label className="gallery-check">
            <Checkbox
              checked={failAction}
              onChange={(event) => setFailAction(event.target.checked)}
            />
            Simulate action failure
          </label>
        </div>
        <p role="status">{menuNotice || 'Choose an action to try the menus.'}</p>
        <output aria-label="Confirmation results">
          Attempts: {attempts} · Completed: {completed}
        </output>
      </section>
      <section className="gallery-section" id="navigation" aria-labelledby="navigation-title">
        <SectionHeader
          title="Find your place"
          titleId="navigation-title"
          description="Tabs switch panels. Filters select which items to show."
        />
        <Tabs.Root defaultValue="overview">
          <Tabs.List aria-label="Project sections">
            <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
            <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
            <Tabs.Trigger value="settings" disabled>
              Settings
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="overview">
            <p>Your project at a glance.</p>
          </Tabs.Content>
          <Tabs.Content value="activity">
            <p>Recent changes appear here.</p>
          </Tabs.Content>
        </Tabs.Root>
        <SegmentedControl
          label="Status filter"
          value={filter}
          onChange={setFilter}
          items={[
            { id: 'all', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'done', label: 'Done' },
          ]}
        />
        <output aria-label="Selected filter">Showing {filter}</output>
      </section>
      <section className="gallery-section" id="feedback" aria-labelledby="feedback-title">
        <SectionHeader
          title="Keep people informed"
          titleId="feedback-title"
          description="Clear progress, useful empty states, and recoverable errors."
        />
        <div className="gallery-states">
          <LoadingState label="Loading projects…" />
          <EmptyState
            icon={Inbox}
            title="A fresh start"
            description="Create a project when you are ready."
            action={
              <Button variant="outline">
                <Plus size={16} />
                Create a project
              </Button>
            }
          />
          <ErrorState
            title="Could not load projects"
            description="Try loading this view again."
            action={<Button variant="outline">Retry</Button>}
          />
        </div>
        <InlineNotice tone="success">Your settings have been saved.</InlineNotice>
        <InlineNotice tone="warning">There are unsaved changes.</InlineNotice>
        <div className="gallery-copy">
          <FormField label="Text to copy">
            <Input
              value={clipboardText}
              onChange={(event) => setClipboardText(event.target.value)}
            />
          </FormField>
          <CopyButton
            text={clipboardText}
            label="Copy example"
            resetAfterMs={0}
            copy={async (value) => {
              if (failCopy) throw new Error('Clipboard unavailable');
              setClipboard(value);
            }}
          />
          <label className="gallery-check">
            <Checkbox checked={failCopy} onChange={(event) => setFailCopy(event.target.checked)} />
            Simulate copy failure
          </label>
        </div>
        <output aria-label="Example clipboard">
          {clipboard || 'Copied text appears here; your clipboard is untouched.'}
        </output>
      </section>
      <section className="gallery-section" id="data" aria-labelledby="data-title">
        <SectionHeader
          title="Useful information, clearly laid out"
          titleId="data-title"
          description="Simple primitives that leave sorting, fetching, and permissions with the app."
        />
        <div className="gallery-stats">
          <Stat label="Projects" value="12" description="Across your workspace" />
          <Stat
            label="Ready for review"
            value="4"
            action={<Button variant="ghost">Review changes</Button>}
          />
          <Stat label="Completed" value="28" description="This month" />
        </div>
        <DefinitionList
          items={[
            { label: 'Workspace', value: 'Garden studio' },
            { label: 'Status', value: <Badge variant="success">Ready</Badge> },
            { label: 'Owner', value: 'hello@example.invalid' },
          ]}
        />
        <Table label="Sample projects">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">State</th>
              <th scope="col">Owner</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {['Garden studio', 'Mobile companion', 'Marketing site'].map((name, index) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>
                  <Badge variant={index ? 'default' : 'success'}>
                    {index ? 'In progress' : 'Ready'}
                  </Badge>
                </td>
                <td>hello@example.invalid</td>
                <td>Today</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <footer className="gallery-footer">
        Shared behavior in @jackalope/ui · Brand foundations in @jackalope/brand
      </footer>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The UI gallery root is missing.');
const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) {
  const paths = (['antler', 'farEar', 'nearEar', 'head'] as const)
    .map((part) => `<path d="${characterPaths[part]}"/>`)
    .join('');
  favicon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${characterMarkViewBox}"><rect x="25" y="-3" width="128" height="128" rx="26" fill="white"/><g fill="#171717">${paths}</g></svg>`)}`;
}
createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
