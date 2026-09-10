import { PRESET_THEMES, themeTokens } from '@jackalope/brand/tokens';

const css = (isDark: boolean) =>
  Object.entries(themeTokens({ ...PRESET_THEMES[0], isDark }))
    .map(([key, value]) => `${key}:${value};`)
    .join('');
export function adminPage(nonce: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jackalope · Release observatory</title>
<style nonce="${nonce}">
:root{${css(false)}--surface:var(--color-surface);--text:var(--color-text-primary);--muted:var(--color-text-secondary);--line:var(--color-border);--accent:var(--color-accent-ink)}@media(prefers-color-scheme:dark){:root{${css(true)}}}*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font:16px/1.6 system-ui}main{max-width:1120px;margin:auto;padding:40px 24px}header{border-bottom:1px solid var(--line);padding-bottom:20px}h1{font-size:clamp(28px,5vw,42px);font-weight:550;letter-spacing:-.04em;margin:8px 0}h2{font-size:22px;margin-top:32px}p{color:var(--muted);max-width:78ch}label{display:inline-flex;gap:8px;align-items:center;margin:12px 16px 12px 0}button,select{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 12px}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.filters{display:flex;flex-wrap:wrap;align-items:center}.summary{display:flex;flex-wrap:wrap;gap:28px;margin:24px 0}.summary strong{font-size:32px;display:block;color:var(--accent)}.table{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:10px;border-bottom:1px solid var(--line);white-space:nowrap}article{border-top:1px solid var(--line);padding:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}small{color:var(--muted)}[role=alert]{color:var(--accent)}.badge{font-size:12px;text-transform:uppercase;letter-spacing:.13em;color:var(--accent)}[hidden]{display:none}
</style>
</head>
<body>
<main>
<header>
<a href="/admin/access">Manage early access</a>
<span class="badge">Jackalope / private</span>
<h1>Release observatory</h1>
<p>See which releases are being used, where work fails, and what people ask for next.</p>
</header>
<div class="filters">
<label>Window<select id="days">
<option value="7">7 days</option>
<option value="30">30 days</option>
</select>
</label>
<label>Channel<select id="channel">
<option value="all">All channels</option>
<option>stable</option>
<option>beta</option>
</select>
</label>
<label>Version<select id="version">
<option value="">All versions</option>
</select>
</label>
<button id="refresh">Refresh</button>
</div>
<p id="error" role="alert">
</p>
<p id="coverage" role="status">Loading aggregate counts…</p>
<div id="summary" class="summary">
</div>
<h2>Release activity</h2>
<p>App opens are sessions, not people. Error counts cover reported categories; they are not a crash-free-user rate.</p>
<div id="releases" class="table">
</div>
<h2>Feature use and errors</h2>
<div id="events" class="table">
</div>
<h2>Feedback inbox</h2>
<label>Status<select id="status">
<option>new</option>
<option>reviewing</option>
<option>planned</option>
<option>closed</option>
<option>all</option>
</select>
</label>
<div id="inbox">
</div>
<button id="more" hidden>Load older reports</button>
<p>Telemetry stores daily totals and short-lived deduplication receipts without installation IDs. Written feedback is voluntarily shared content and may contain personal information.</p>
</main>
<script nonce="${nonce}">
const el = (id) => document.getElementById(id);
let cursor = null,
  busy = false,
  epoch = 0;
async function api(path, options) {
  const r = await fetch(path, { credentials: 'same-origin', ...options });
  if (!r.ok)
    throw Error(
      r.status === 403
        ? 'Your admin session is missing or expired. Sign in through Cloudflare Access.'
        : 'Could not load data. Try again.',
    );
  return r.json();
}
function table(target, headers, rows) {
  const t = document.createElement('table'),
    head = t.createTHead().insertRow();
  headers.forEach((v) => {
    const c = document.createElement('th');
    c.scope = 'col';
    c.textContent = v;
    head.append(c);
  });
  const body = t.createTBody();
  rows.forEach((row) => {
    const tr = body.insertRow();
    row.forEach((v) => (tr.insertCell().textContent = String(v)));
  });
  el(target).replaceChildren(t);
  if (!rows.length) {
    const p = document.createElement('p');
    p.textContent = 'No events in this selection.';
    el(target).append(p);
  }
}
async function overview() {
  const generation = ++epoch;
  const p = new URLSearchParams({
    days: el('days').value,
    channel: el('channel').value,
    version: el('version').value,
  });
  const data = await api('/admin/api/overview?' + p);
  if (generation !== epoch) return;
  el('coverage').textContent =
    (data.truncated ? 'Partial results: narrow the filters. ' : '') +
    data.coverage +
    ' Retention: ' +
    data.retentionDays +
    ' days. Ingestion ' +
    (data.ingestionEnabled ? 'on' : 'off') +
    ' · Email ' +
    (data.emailEnabled ? 'on' : 'off') +
    '.';
  const value = el('version').value;
  el('version').replaceChildren(
    new Option('All versions', ''),
    ...data.versions.map((v) => new Option(v.version, v.version)),
  );
  el('version').value = value;
  const sum = (name) =>
    data.metrics.filter((m) => m.name === name).reduce((n, m) => n + m.count, 0);
  el('summary').replaceChildren();
  for (const [label, name] of [
    ['App opens', 'app_opened'],
    ['Task transitions', 'task_state'],
    ['Feature uses', 'feature_used'],
    ['Reported errors', 'app_error'],
  ]) {
    const d = document.createElement('div'),
      s = document.createElement('strong');
    s.textContent = sum(name);
    d.append(s, label);
    el('summary').append(d);
  }
  const releases = new Map(),
    events = new Map();
  for (const m of data.metrics) {
    const k = m.version + ' / ' + m.channel + ' / ' + m.os;
    if (!releases.has(k)) releases.set(k, [m.version, m.channel, m.os, 0, 0, 0]);
    const r = releases.get(k);
    if (m.name === 'app_opened') r[3] += m.count;
    if (m.name === 'task_state' && m.dimension === 'starting') r[4] += m.count;
    if (m.name === 'app_error') r[5] += m.count;
    if (m.name === 'feature_used' || m.name === 'app_error') {
      const k = m.name + ' / ' + m.dimension;
      events.set(k, (events.get(k) || 0) + m.count);
    }
  }
  table(
    'releases',
    ['Version', 'Channel', 'OS', 'Opens', 'Tasks started', 'Errors'],
    [...releases.values()],
  );
  table(
    'events',
    ['Event / category', 'Count'],
    [...events.entries()].sort((a, b) => b[1] - a[1]),
  );
}
async function inbox(append = false) {
  const p = new URLSearchParams({ status: el('status').value });
  if (append && cursor) p.set('before', cursor);
  const data = await api('/admin/api/feedback?' + p);
  if (!append) el('inbox').replaceChildren();
  for (const row of data.reports) {
    const report = JSON.parse(row.payload),
      a = document.createElement('article'),
      h = document.createElement('h3'),
      meta = document.createElement('small'),
      text = document.createElement('pre'),
      label = document.createElement('label'),
      select = document.createElement('select');
    h.textContent =
      (report.kind || 'feedback') +
      ' · ' +
      (report.appVersion || 'Email response') +
      ' / ' +
      (report.channel || (report.source === 'email' ? 'private invitation' : 'legacy'));
    meta.textContent =
      row.id +
      ' · ' +
      new Date(row.received_at).toLocaleDateString() +
      ' · email ' +
      row.email_state;
    text.textContent = report.message;
    label.textContent = 'Report status';
    for (const v of ['new', 'reviewing', 'planned', 'closed']) select.add(new Option(v, v));
    select.value = row.status;
    select.onchange = () =>
      run(async () => {
        await api('/admin/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: row.id, status: select.value }),
        });
        await inbox();
      });
    label.append(select);
    a.append(h, meta, text, label);
    el('inbox').append(a);
  }
  if (!el('inbox').children.length) el('inbox').textContent = 'No reports in this view.';
  cursor = data.reports.at(-1)?.cursor;
  el('more').hidden = data.reports.length < 50;
}
async function run(fn) {
  if (busy) return;
  busy = true;
  el('error').textContent = '';
  document.querySelectorAll('button,select').forEach((e) => (e.disabled = true));
  try {
    await fn();
  } catch (e) {
    el('error').textContent = e.message;
  } finally {
    busy = false;
    document.querySelectorAll('button,select').forEach((e) => (e.disabled = false));
  }
}
el('refresh').onclick = () =>
  run(async () => {
    await overview();
    await inbox();
  });
for (const id of ['days', 'channel', 'version']) el(id).onchange = () => run(overview);
el('status').onchange = () => run(() => inbox());
el('more').onclick = () => run(() => inbox(true));
run(async () => {
  await overview();
  await inbox();
});
</script>
</body>
</html>`;
}
