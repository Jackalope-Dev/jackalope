import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowRight,
  Check,
  CheckCheck,
  Code2,
  FileCode2,
  GitBranch,
  Lightbulb,
  RotateCcw,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { BrandMark } from './BrandMark';
import { WaitlistButton } from './Signup';
import './workflow-demo.css';

const examples = [
  {
    label: 'Build a feature',
    title: 'Make search feel effortless.',
    brief:
      'Add keyboard navigation to search. Arrow keys move through results, Enter opens a result, and Escape closes the list.',
    tasks: ['Build keyboard navigation', 'Polish the search experience'],
    file: 'src/components/Search.tsx',
    removed: '<SearchResults items={results} />',
    added: [
      '<SearchResults',
      '  items={results}',
      '  activeIndex={activeIndex}',
      '  onKeyDown={handleNavigation}',
      '/>',
    ],
    result:
      'Search now works from the keyboard. The selected result stays visible, and Escape returns focus to the search field.',
    checks: ['Keyboard navigation', 'Focus return', 'Project build'],
  },
  {
    label: 'Fix a rough edge',
    title: 'Keep the good ideas, even after a refresh.',
    brief:
      'Save unfinished task drafts locally. Restore the draft after a refresh, and clear it only when the task is created.',
    tasks: ['Persist the task draft', 'Check restore and reset behavior'],
    file: 'src/components/TaskComposer.tsx',
    removed: 'const [draft, setDraft] = useState("");',
    added: ['const [draft, setDraft] = useSavedDraft(', '  "task-composer",', ');'],
    result:
      'Unfinished drafts return when you reopen the composer. Creating a task clears the saved draft for your next idea.',
    checks: ['Draft restoration', 'Reset after creation', 'Project build'],
  },
  {
    label: 'Polish the details',
    title: 'Give every theme a little more care.',
    brief:
      'Make the settings controls work in light and dark themes. Use shared colors and keep keyboard focus easy to see.',
    tasks: ['Refine the settings controls', 'Check themes and keyboard focus'],
    file: 'src/components/Settings.css',
    removed: 'color: #888;',
    added: [
      'color: var(--color-text-secondary);',
      'background: var(--color-surface);',
      'outline-color: var(--color-accent-ink);',
    ],
    result:
      'Settings follows the chosen theme, with readable labels and visible focus for keyboard navigation.',
    checks: ['Light and dark themes', 'Keyboard focus', 'Project build'],
  },
];

const steps = [
  { id: 'brief', label: 'Start with an idea', icon: Lightbulb },
  { id: 'work', label: 'Give it room to run', icon: GitBranch },
  { id: 'review', label: 'Keep the final say', icon: CheckCheck },
];

export function WorkflowDemo() {
  const [example, setExample] = useState(0);
  const [step, setStep] = useState('brief');
  const [agent, setAgent] = useState('Codex');
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  function goToStep(next: string) {
    setStep(next);
    triggers.current[next]?.focus({ preventScroll: true });
  }
  const selected = examples[example];
  return (
    <div className="workflow-demo" id="playground">
      <div className="demo-chrome">
        <span>
          <BrandMark /> Your ideas have company.
        </span>
        <span className="demo-label">INTERACTIVE DEMO</span>
      </div>
      <fieldset className="demo-examples" aria-label="Choose a sample task">
        <span>What’s on your mind?</span>
        {examples.map((item, index) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={index === example}
            onClick={() => {
              setExample(index);
              setStep('brief');
            }}
          >
            {item.label}
          </button>
        ))}
      </fieldset>
      <Tabs.Root value={step} onValueChange={setStep} className="demo-workspace">
        <Tabs.List aria-label="Try the task workflow" className="demo-steps">
          {steps.map(({ id, label, icon: Icon }, index) => (
            <Tabs.Trigger
              key={id}
              value={id}
              ref={(node) => {
                triggers.current[id] = node;
              }}
            >
              <span className="demo-step-icon">
                <Icon size={19} />
              </span>
              <span>
                <small>0{index + 1}</small>
                {label}
              </span>
              <ArrowRight size={15} />
            </Tabs.Trigger>
          ))}
          <div className="demo-project">
            <GitBranch size={15} />
            <span>Atlas / sample project</span>
          </div>
        </Tabs.List>
        <div className="demo-stage">
          <Tabs.Content value="brief" className="demo-panel">
            <div className="demo-panel-heading">
              <span className="demo-kicker">THE BRIEF</span>
              <span>01 / 03</span>
            </div>
            <h2>{selected.title}</h2>
            <p className="demo-brief">{selected.brief}</p>
            <fieldset className="demo-agent-picker" aria-label="Choose a demo agent">
              <span>Bring your favorite</span>
              {['Codex', 'Claude Code', 'Grok', 'OpenCode'].map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={agent === name}
                  onClick={() => setAgent(name)}
                >
                  {agent === name && <Check size={13} />}
                  {name}
                </button>
              ))}
            </fieldset>
            <div className="demo-panel-footer">
              <span>Your project. Your context.</span>
              <button
                className="button button-primary"
                type="button"
                onClick={() => goToStep('work')}
              >
                Explore parallel work <ArrowRight size={16} />
              </button>
            </div>
          </Tabs.Content>
          <Tabs.Content value="work" className="demo-panel">
            <div className="demo-panel-heading">
              <span className="demo-kicker">ROOM FOR BOTH</span>
              <span>02 / 03</span>
            </div>
            <h2>Two tasks. Their own space.</h2>
            <p>
              Separate worktrees keep changes apart. You choose the tasks and agents; Jackalope
              coordinates their scopes and dependencies.
            </p>
            <div className="demo-branches">
              {selected.tasks.map((task, index) => (
                <div key={task}>
                  <GitBranch size={20} />
                  <div>
                    <strong>{task}</strong>
                    <span>
                      {index === 0 ? agent : agent === 'Claude Code' ? 'Codex' : 'Claude Code'} ·
                      worktree 0{index + 1}
                    </span>
                  </div>
                  <span className="demo-task-state">
                    {index === 0 ? 'Sample patch ready' : 'Sample checks ready'}
                  </span>
                </div>
              ))}
            </div>
            <div className="demo-panel-footer">
              <span>Independent work, shared direction.</span>
              <button
                className="button button-primary"
                type="button"
                onClick={() => goToStep('review')}
              >
                Inspect the sample result <ArrowRight size={16} />
              </button>
            </div>
          </Tabs.Content>
          <Tabs.Content value="review" className="demo-panel">
            <div className="demo-panel-heading">
              <span className="demo-kicker">BACK TO YOU</span>
              <span>03 / 03</span>
            </div>
            <h2>The result, with the receipts.</h2>
            <p>{selected.result}</p>
            <section className="demo-diff" aria-label="Illustrative code patch">
              <div>
                <FileCode2 size={14} />
                {selected.file}
                <span>Sample excerpt</span>
              </div>
              <pre>
                <code>
                  <span className="demo-removed">
                    − {selected.removed}
                    {'\n'}
                  </span>
                  {selected.added.map((line) => (
                    <span className="demo-added" key={line}>
                      + {line}
                      {'\n'}
                    </span>
                  ))}
                </code>
              </pre>
            </section>
            <ul className="demo-checks" aria-label="Illustrative passed checks">
              {selected.checks.map((check) => (
                <li key={check}>
                  <Check size={13} />
                  {check}
                </li>
              ))}
            </ul>
            <div className="demo-panel-footer">
              <button className="demo-restart" type="button" onClick={() => goToStep('brief')}>
                <RotateCcw size={14} />
                Try another idea
              </button>
              <WaitlistButton label="I want to build like this" />
            </div>
          </Tabs.Content>
        </div>
      </Tabs.Root>
      <div className="demo-footnote">
        <Code2 size={14} />
        <span>A little hands-on preview. Sample tasks and results; no agents run here.</span>
        <a href="#workflow">
          See the actual app <ArrowRight size={14} />
        </a>
      </div>
    </div>
  );
}
