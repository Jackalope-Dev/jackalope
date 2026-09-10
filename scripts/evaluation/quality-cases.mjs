const prelude = `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
`;

const checks = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyTasks } from './scheduler.mjs';
for (let n = 0; n < 80; n++) test('preserves ready tasks ' + n, () => {
  assert.deepEqual(readyTasks([{id:'a',priority:n,dependsOn:[]}], []), ['a']);
});
test('dependencies and priority', () => {
  const tasks = [
    {id:'low', priority:1, dependsOn:[]},
    {id:'blocked', priority:10, dependsOn:['unknown']},
    {id:'high', priority:3, dependsOn:['done']},
    {id:'equal', priority:3, dependsOn:[]},
  ];
  assert.deepEqual(readyTasks(tasks, ['done']), ['high','equal','low']);
});
`;

export const qualityCases = [
  {
    id: 'copy-edit',
    allowedFiles: ['README.md'],
    prompt:
      'Fix the spelling mistake "recieve" in README.md. Do not add tests or change application code. Preserve the rest of the document exactly and leave changes uncommitted.',
    files: {
      'README.md':
        '# Delivery\n\nCustomers recieve a receipt after checkout.\n\nKeep the existing public API unchanged.\n',
      'app.mjs': 'export const delivery = "email";\n',
    },
    check: 'node --check app.mjs',
    oracle: `${prelude}
assert.equal(read('README.md'), '# Delivery\\n\\nCustomers receive a receipt after checkout.\\n\\nKeep the existing public API unchanged.\\n');
assert.equal(read('app.mjs'), 'export const delivery = "email";\\n');
assert.deepEqual(fs.readdirSync(root).filter(n => n !== '.git').sort(), ['README.md','app.mjs']);
`,
  },
  {
    id: 'design-tokens',
    allowedFiles: ['button.css'],
    prompt:
      'Use design tokens for the button colors in button.css. Replace its hardcoded background, foreground and border colors with the matching existing --action-bg, --action-fg and --action-border variables from theme.css. Preserve its geometry, hover opacity and focus outline. Change only button.css; do not add tests. Leave changes uncommitted.',
    files: {
      'button.css':
        '.button { background: #2060df; color: #ffffff; border: 1px solid #174cb3; padding: 8px 16px; border-radius: 6px; }\n.button:hover { opacity: 0.9; }\n.button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }\n',
      'theme.css':
        ':root { --action-bg: #2060df; --action-fg: #ffffff; --action-border: #174cb3; }\n[data-theme="dark"] { --action-bg: #82abff; --action-fg: #10203a; --action-border: #aac5ff; }\n',
      'verify.cjs':
        'const assert=require("node:assert/strict"); const fs=require("node:fs"); const css=fs.readFileSync("button.css","utf8"); for(const token of ["action-bg","action-fg","action-border"]) assert.ok(css.includes("var(--"+token+")"), token);\n',
    },
    check: 'node verify.cjs',
    oracle: `${prelude}
const css=read('button.css');
assert.match(css, /background:\\s*var\\(--action-bg\\)/);
assert.match(css, /color:\\s*var\\(--action-fg\\)/);
assert.match(css, /border:\\s*1px solid var\\(--action-border\\)/);
for(const rule of ['padding: 8px 16px','border-radius: 6px','opacity: 0.9','outline: 2px solid currentColor','outline-offset: 2px']) assert.ok(css.includes(rule), rule);
assert.ok(!/#[a-f0-9]{3,8}/i.test(css));
`,
  },
  {
    id: 'scheduler-fix',
    allowedFiles: ['scheduler.mjs'],
    prompt:
      'Fix readyTasks(tasks, completed) in scheduler.mjs. Return the IDs of tasks whose dependencies are ALL completed, excluding IDs already completed. Sort by descending priority, treating missing priority as 0; ties preserve input order. Unknown dependencies stay blocked. Do not mutate inputs. Preserve the export and handle empty inputs. Change only scheduler.mjs. Run the saved project verification command node --test through Jackalope computer_verify, inspect any failures and correct the implementation. Leave changes uncommitted.',
    files: {
      'package.json': '{"type":"module"}\n',
      'scheduler.mjs':
        'export function readyTasks(tasks, completed) {\n  return tasks.filter(t => t.dependsOn.length === 0 || t.dependsOn.some(id => completed.includes(id))).map(t => t.id);\n}\n',
      'scheduler.test.mjs': checks,
    },
    check: 'node --test',
    oracle: `${prelude}
const {pathToFileURL}=require('node:url');
(async()=>{
const {readyTasks}=await import(pathToFileURL(path.join(root,'scheduler.mjs')));
const tasks=[{id:'low',priority:1,dependsOn:[]},{id:'missing',priority:10,dependsOn:['unknown']},{id:'half',priority:9,dependsOn:['done','unknown']},{id:'done',priority:100,dependsOn:[]},{id:'high',priority:3,dependsOn:['done']},{id:'equal',priority:3,dependsOn:[]},{id:'zero',dependsOn:[]},{id:'negative',priority:-2,dependsOn:[]}];
const before=JSON.stringify(tasks), completed=['done'];
assert.deepEqual(readyTasks(tasks, completed), ['high','equal','low','zero','negative']);
assert.equal(JSON.stringify(tasks), before);
assert.deepEqual(completed,['done']);
assert.deepEqual(readyTasks([],[]),[]);
assert.deepEqual(readyTasks([{id:'x',dependsOn:['x']}],[]),[]);
})().catch(e=>{console.error(e);process.exitCode=1});
`,
  },
];

for (const fixture of qualityCases) {
  const protectedFiles = Object.fromEntries(
    Object.entries(fixture.files).filter(([name]) => !fixture.allowedFiles.includes(name)),
  );
  fixture.oracle += `\nfor (const [name, content] of Object.entries(${JSON.stringify(protectedFiles)})) assert.equal(read(name), content, 'Unrelated file changed: '+name);\nassert.deepEqual(fs.readdirSync(root).filter(n=>n!=='.git').sort(), ${JSON.stringify(Object.keys(fixture.files).sort())}, 'Unexpected files');\n`;
}
