import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [comparisonPath, output, seed = 'review-1'] = process.argv.slice(2);
if (!comparisonPath || !output)
  throw new Error('Usage: review-study.mjs comparison.json output-directory [assignment-seed]');
const comparison = JSON.parse(await readFile(comparisonPath, 'utf8'));
await mkdir(output, { recursive: true });
if (
  await access(path.join(output, 'assignment-key.json')).then(
    () => true,
    () => false,
  )
)
  throw new Error(
    'This study already exists. Preserve its assignments and answers; choose a new directory.',
  );
const chosen = new Map();
for (const row of comparison.trials) {
  if (row.receipt && !chosen.has(row.case)) chosen.set(row.case, row);
}
const ranked = [...chosen.values()]
  .sort((a, b) =>
    createHash('sha256')
      .update(seed + a.case)
      .digest('hex')
      .localeCompare(
        createHash('sha256')
          .update(seed + b.case)
          .digest('hex'),
      ),
  )
  .slice(0, 8);
const key = [],
  cards = [];
if (ranked.length < 4)
  throw new Error('Complete at least four distinct tasks before preparing a review study.');
for (const [index, row] of ranked.entries()) {
  const receipt = JSON.parse(await readFile(row.receipt, 'utf8'));
  const spec = JSON.parse(
    await readFile(
      path.join(path.dirname(comparisonPath), `${row.case}-${row.repetition}-${row.variant}.json`),
      'utf8',
    ),
  );
  if (!receipt.run?.workspace)
    throw new Error(
      `Missing review workspace for ${row.case}; retain the failed trial separately.`,
    );
  const diff = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', 'HEAD'], {
    cwd: receipt.run.workspace,
    encoding: 'utf8',
    maxBuffer: 2e6,
  });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: receipt.run.workspace,
    encoding: 'utf8',
  }).trim();
  if (untracked)
    throw new Error(
      'Review export requires tracked-only patches; untracked files must not be silently omitted.',
    );
  const changed = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], {
    cwd: receipt.run.workspace,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const source = [];
  for (const name of changed) {
    const resolved = path.resolve(receipt.run.workspace, name);
    if (!resolved.startsWith(path.resolve(receipt.run.workspace) + path.sep))
      throw new Error('Changed path is outside the review workspace.');
    source.push({
      name,
      before: execFileSync('git', ['show', `HEAD:${name}`], {
        cwd: receipt.run.workspace,
        encoding: 'utf8',
      }),
      after: await readFile(resolved, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '(Deleted)';
        throw error;
      }),
    });
  }
  const id = randomUUID();
  const evidence = index % 2 === 0;
  key.push({
    id,
    receipt: row.receipt,
    case: row.case,
    condition: evidence ? 'evidence' : 'diff',
    oraclePassed: row.oraclePassed,
  });
  cards.push({
    id,
    request:
      spec.rawPrompt ??
      spec.prompt
        .replace(/^### 🎯 Objective\n/, '')
        .split('\n\n### 📐 Guidelines & Quality Constraints')[0],
    diff,
    source,
    evidence: evidence
      ? {
          summary: receipt.run.result ?? '',
          check: receipt.run.verification
            ? {
                command: receipt.run.verification.command,
                success: receipt.run.verification.result?.success,
                exitCode: receipt.run.verification.result?.exitCode,
              }
            : null,
          assessments: (receipt.run.validationSteps ?? [])
            .flatMap((step) => step.requirements ?? [])
            .map((item) => ({
              requirement:
                spec.outcomes?.[Number(item.requirementId?.replace('requirement-', ''))] ??
                item.requirementId,
              status: item.status,
              summary: item.summary,
              evidence: item.evidence,
            })),
        }
      : null,
  });
}
const study = randomUUID();
await writeFile(
  path.join(output, 'assignment-key.json'),
  JSON.stringify({ study, seed, key, source: comparisonPath }, null, 2),
);
const data = JSON.stringify({ study, cards }).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jackalope review study</title>
<style>:root{color-scheme:light dark;font:16px system-ui;line-height:1.5}body{max-width:1100px;margin:auto;padding:24px}button,textarea{font:inherit;padding:10px;min-height:44px}button{cursor:pointer;margin-right:8px}textarea{display:block;box-sizing:border-box;width:100%;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #888;border-radius:8px}#evidence{border-left:4px solid #888;padding:0 16px}button:focus-visible,textarea:focus-visible{outline:3px solid #598cea;outline-offset:3px}.muted{opacity:.75}[hidden]{display:none}</style>
<h1>Review a proposed change</h1><p>Assess whether each patch meets its request. Some cards include recorded checks and agent assessments. These are evidence to assess, not a guarantee. You will see each task once; model and configuration names are concealed.</p><p class="muted">This is a small exploratory review study, not a production speed benchmark. The timer counts time while this page is visible and focused. Pause whenever you are distracted. No data leaves this page; download your answers when done.</p><p id="progress"></p><button id="start">Start review</button><button id="pause" hidden>Pause</button><section id="card" hidden><h2>Request</h2><pre id="request"></pre><section id="evidence" hidden><h2>Recorded evidence</h2><pre id="checks"></pre></section><h2>Diff</h2><pre id="diff" tabindex="0"></pre><details id="source-details"><summary>Inspect complete changed files</summary><pre id="source"></pre></details><label for="notes">Why would you approve or request changes? Note missing evidence or defects.</label><textarea id="notes" rows="4"></textarea><button id="approve">Approve</button><button id="revise">Request changes</button></section><button id="download" hidden>Download answers</button><p id="status" role="status"></p>
<script>const data=${data};let index=0,seconds=0,running=false,last=performance.now();const answers=JSON.parse(localStorage.getItem("jackalope-review-"+data.study)||"[]");index=answers.length;const byId=id=>document.getElementById(id);function tick(){const now=performance.now();if(running&&!document.hidden&&document.hasFocus())seconds+=(now-last)/1000;last=now;}setInterval(tick,250);document.addEventListener('visibilitychange',tick);window.addEventListener('blur',tick);window.addEventListener('focus',()=>last=performance.now());function show(){running=false;seconds=0;byId('card').hidden=true;byId('pause').hidden=true;byId('start').hidden=index>=data.cards.length;byId('progress').textContent='Task '+Math.min(index+1,data.cards.length)+' of '+data.cards.length;byId('notes').value='';if(index>=data.cards.length){byId('download').hidden=false;byId('status').textContent='Review complete. Download your answers and share their local path in the task.';return;}const item=data.cards[index];byId('request').textContent=item.request;byId('diff').textContent=item.diff||'(No recorded changes)';byId('source-details').open=false;byId('source').textContent=item.source.map(f=>f.name+'\\nBEFORE\\n'+f.before+'\\nAFTER\\n'+f.after).join('\\n\\n');byId('evidence').hidden=!item.evidence;byId('checks').textContent=item.evidence ? ['Agent summary: '+(item.evidence.summary || 'No summary recorded'), (item.evidence.check ? 'Saved check: '+item.evidence.check.command+' — '+(item.evidence.check.success===true?'Passed':item.evidence.check.success===false?'Failed':'Unknown')+' (exit '+item.evidence.check.exitCode+')':'No saved check'), ...item.evidence.assessments.map(a=>'Requirement: '+a.requirement+'\\nAgent assessment: '+a.status+' — '+a.summary+'\\nEvidence: '+a.evidence)].join('\\n\\n') : '';}byId('start').onclick=()=>{running=true;last=performance.now();byId('card').hidden=false;byId('start').hidden=true;byId('pause').hidden=false;byId('pause').textContent='Pause';};byId('pause').onclick=()=>{tick();running=!running;byId('pause').textContent=running?'Pause':'Resume';byId('card').hidden=!running;};function answer(accepted){tick();if(!byId('notes').value.trim()){byId('status').textContent='Please give a brief reason.';return;}answers.push({id:data.cards[index].id,accepted,reviewMinutes:seconds/60,notes:byId('notes').value});localStorage.setItem("jackalope-review-"+data.study,JSON.stringify(answers));index++;byId('status').textContent='';show();}byId('approve').onclick=()=>answer(true);byId('revise').onclick=()=>answer(false);byId('download').onclick=()=>{const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify({study:data.study,answers,measurement:'Focused visible page time; manually pause distractions. No correction time collected.'},null,2)],{type:'application/json'}));a.href=url;a.download='review-answers.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};show();</script></html>`;
await writeFile(path.join(output, 'index.html'), html);
console.log(
  JSON.stringify({
    file: path.resolve(output, 'index.html'),
    cards: cards.length,
    scope:
      'Single-reviewer pilot; conditions alternate within a seeded task shuffle. No matched causal estimate until counterbalanced reviewers and defect-detection checks are complete.',
  }),
);
