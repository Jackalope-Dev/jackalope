import { useState } from 'react';
import { AgentQuestion } from '../components/tasks/AgentQuestion';
import { PatchPreview } from '../components/tasks/PatchPreview';
import { TaskActivity } from '../components/tasks/TaskActivity';
import { TaskContextPanel } from '../components/tasks/TaskContextPanel';
import TaskMarkdown from '../components/tasks/TaskMarkdown';
import { Button } from '../components/ui/button';
import { Select, SelectItem } from '../components/ui/Select';
import { assemblePrompt } from '../lib/skills/context-assembler';
import type { PendingUserPrompt } from '../lib/task-runtime';
import '../components/tasks/task-workspace.css';

const patch =
  'diff --git a/src/search.ts b/src/search.ts\n--- a/src/search.ts\n+++ b/src/search.ts\n@@ -1,3 +1,3 @@\n export function search(query: string) {\n-  return query;\n+  return query.trim();\n }';
const activity = [
  'Read src/search.ts\nexport function search(query: string) {\n  return query;\n}',
  'Run pnpm test\nSearch suite: 4 passed',
  'Edited src/search.ts\nTrim whitespace before searching.',
];

export function TaskExperienceExamples() {
  const [scenario, setScenario] = useState('choice');
  const [revision, setRevision] = useState(0);
  const [fail, setFail] = useState(false);
  const [selected, setSelected] = useState(['systematic-debugging']);
  const [long, setLong] = useState(false);
  const [answer, setAnswer] = useState('');
  const prompt: PendingUserPrompt = {
    id: 'example',
    runId: 'design-lab',
    question:
      scenario === 'multiple'
        ? 'Which checks should this task include?'
        : 'How should search handle whitespace?',
    inputType:
      scenario === 'multiple'
        ? 'multiChoice'
        : scenario === 'confirmation'
          ? 'confirmation'
          : scenario === 'text'
            ? 'text'
            : 'choice',
    options:
      scenario === 'multiple'
        ? ['Keyboard navigation', 'Narrow layout', 'Screen-reader labels']
        : ['Trim surrounding whitespace', 'Keep the exact input'],
    status: scenario === 'answered' ? 'answered' : 'pending',
    answer: scenario === 'answered' ? 'Trim surrounding whitespace' : undefined,
    createdAt: '2026-09-06T12:00:00Z',
  };
  const finalPrompt = assemblePrompt({
    rawPrompt: 'Fix whitespace handling in search.',
    selectedSkillIds: selected,
  }).assembledPrompt;
  return (
    <section
      className="rounded-3xl bg-[var(--color-bg)] p-6 mt-8"
      aria-labelledby="task-examples-title"
    >
      <h2 id="task-examples-title" className="text-base font-medium">
        Task experience
      </h2>
      <p className="task-experience-muted mt-2">
        Interactive examples with fictional data. No agents run and no responses leave this page.
      </p>
      <div className="flex flex-wrap gap-3 items-center my-5">
        <Select
          aria-label="Question example"
          value={scenario}
          onValueChange={(value) => {
            setScenario(value);
            setAnswer('');
          }}
        >
          <SelectItem value="choice">Choice</SelectItem>
          <SelectItem value="multiple">Multiple selections</SelectItem>
          <SelectItem value="text">Free text</SelectItem>
          <SelectItem value="confirmation">Confirmation</SelectItem>
          <SelectItem value="answered">Answered</SelectItem>
          <SelectItem value="ended">Ended attempt</SelectItem>
        </Select>
        <Button
          variant="ghost"
          onClick={() => {
            setRevision((value) => value + 1);
            setAnswer('');
          }}
        >
          Reset question
        </Button>
        <label className="flex items-center gap-2 min-h-11 text-sm">
          <input
            type="checkbox"
            checked={fail}
            onChange={(event) => setFail(event.target.checked)}
          />
          Simulate send failure
        </label>
      </div>
      <AgentQuestion
        key={`${scenario}:${revision}`}
        prompt={prompt}
        active={scenario !== 'ended'}
        onAnswer={async (value) => {
          if (fail)
            throw new Error('Example connection unavailable. Your answer is preserved; try again.');
          setAnswer(value);
        }}
      />
      {answer && (
        <p role="status" className="task-experience-muted mt-3">
          Example received: {answer}
        </p>
      )}
      <TaskContextPanel
        selected={selected}
        suggested={['systematic-debugging']}
        onToggle={(id) =>
          setSelected((values) =>
            values.includes(id) ? values.filter((value) => value !== id) : [...values, id],
          )
        }
        instructions="Keep changes focused. Run the search tests."
        prompt={`${finalPrompt}\n\n[Project Guidelines]:\nKeep changes focused. Run the search tests.`}
      />
      <label className="flex items-center gap-2 min-h-11 text-sm">
        <input type="checkbox" checked={long} onChange={(event) => setLong(event.target.checked)} />
        Show long examples
      </label>
      <TaskActivity
        entries={
          long
            ? Array.from(
                { length: 150 },
                (_, index) => `Entry ${index + 1}: ${activity[index % activity.length]}`,
              )
            : activity
        }
        active
      />
      <PatchPreview
        key={String(long)}
        patch={
          long
            ? `diff --git a/example.ts b/example.ts\nnew file mode 100644\n--- /dev/null\n+++ b/example.ts\n@@ -0,0 +1,10000 @@\n${Array.from({ length: 10000 }, (_, index) => `+export const example${index + 1} = ${index + 1};`).join('\n')}\n`
            : patch
        }
      />
      <div className="task-result-text mt-6">
        <TaskMarkdown
          active={long}
          onOpenLink={(url) => setAnswer(url)}
          content={
            '## Result\n\nWhitespace is handled.\n\n```typescript\nexport const search = (query: string) => query.trim();\n```\n\n| Check | Result |\n| --- | --- |\n| Search | Passed |\n\n[Documentation](https://example.com) · [Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n\n' +
            (long ? '**Still streaming' : '**Complete.**')
          }
        />
      </div>
    </section>
  );
}
