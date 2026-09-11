import {
  adminHead,
  adminIcon,
  adminNavigationScript,
  adminShell,
  adminStyles,
} from './admin-shell';

export function adminPage(nonce: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overview · Jackalope admin</title>${adminHead}<style nonce="${nonce}">${adminStyles}</style></head><body>${adminShell('overview')}
<div data-view="overview">
<header class="page-heading"><div><div class="eyebrow">Your workspace at a glance</div><h1>Overview</h1><p>Welcome back. Here’s what’s happening with Jackalope.</p></div><button id="refresh-home">${adminIcon('refresh')}Refresh overview</button></header>
<p id="home-error" role="alert"></p><p id="home-updated" class="notice" role="status">Loading your dashboard…</p>
<div id="people-summary" class="metric-grid" aria-label="Account overview"></div>
<div class="two-col"><section class="panel"><div class="section-heading"><div><h2>${adminIcon('people')}Next steps</h2><p>Keep invitations and onboarding moving.</p></div><a href="/admin/access#people">View people</a></div><div id="attention"><p>Loading follow-ups…</p></div></section>
<section class="panel"><div class="section-heading"><h2>${adminIcon('setup')}Service snapshot</h2><a href="/admin/access#setup">Setup</a></div><p id="service-error" role="alert"></p><dl id="service" class="service-list"><div><dt>Configuration</dt><dd>Loading…</dd></div></dl><p class="privacy">Configuration checks do not confirm delivery or a successful installation.</p></section></div>
<section class="panel"><div class="section-heading"><div><h2>${adminIcon('notes')}Stay close to your users</h2><p>Turn requests and feedback into the next useful improvement.</p></div></div><div class="two-col"><a class="quick-link" href="/admin/access#insights"><div><strong>Explore audience insights</strong><small>Platforms, preferred agents and workflow priorities</small></div>${adminIcon('arrow')}</a><a class="quick-link" href="/admin/access#notes"><div><strong>Write a product update</strong><small>Choose changes, preview the email and create a draft</small></div>${adminIcon('arrow')}</a></div></section>
</div>
<div data-view="activity" hidden><header class="page-heading"><div><div class="eyebrow">Product health</div><h1>Usage & releases</h1><p>See reported activity, adoption and errors across releases.</p></div><button id="refresh">${adminIcon('refresh')}Refresh activity</button></header>
<section class="panel"><div class="filters"><label>Window<select id="days"><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label><label>Channel<select id="channel"><option value="all">All channels</option><option>stable</option><option>beta</option></select></label><label>Version<select id="version"><option value="">All versions</option></select></label></div><p id="error" role="alert"></p><p id="activity-updated" class="notice" role="status">Loading aggregate counts…</p><details><summary>About these numbers</summary><p id="coverage"></p></details></section>
<div id="summary" class="metric-grid"></div>
<section class="panel"><div class="section-heading"><div><h2>${adminIcon('activity')}Daily app opens</h2><p>Reported events by UTC receipt date. Includes today’s partial total.</p></div></div><div id="trend"></div></section>
<section class="panel"><div class="section-heading"><div><h2>Release activity</h2><p>App opens are events, not unique people.</p></div></div><div id="releases" class="table" tabindex="0" role="region" aria-label="Release activity"></div></section>
<section class="panel"><h2>Feature use and errors</h2><div id="events" class="table" tabindex="0" role="region" aria-label="Feature use and errors"></div></section></div>
<div data-view="feedback" hidden><header class="page-heading"><div><div class="eyebrow">Listen & improve</div><h1>Feedback</h1><p>A shared inbox for reports, ideas and replies from your users.</p></div><button id="refresh-inbox">${adminIcon('refresh')}Refresh inbox</button></header>
<section class="panel"><div class="section-heading"><label>Status<select id="status"><option value="new">New</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="closed">Closed</option><option value="all">All reports</option></select></label><span id="inbox-count" class="notice" role="status"></span></div><p id="inbox-error" role="alert"></p><div id="inbox"></div><button id="more" hidden>Load older reports</button></section><p class="privacy">Written feedback is voluntarily shared content and may contain personal information. Reports are retained for a limited time.</p></div>
</main>
<script nonce="${nonce}">
${adminNavigationScript}
const el = (id) => document.getElementById(id);
let cursor = null,
  busy = false,
  epoch = 0;
async function api(path, options) {
  const r = await fetch(path, { credentials: 'same-origin', redirect: 'error', ...options });
  if (!r.ok)
    throw Error(
      r.status === 403
        ? 'Your admin session is missing or expired. Sign in through Cloudflare Access.'
        : 'Could not load data. Try again.',
    );
  if (!r.headers.get('content-type')?.includes('application/json')) throw Error('Your admin session may have expired. Sign in again.');
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
    row.forEach((v) => (tr.insertCell().textContent = typeof v==='number'?v.toLocaleString():String(v)));
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
  el('activity-updated').textContent = 'Updated '+new Date().toLocaleTimeString()+(data.truncated?' · Partial results — narrow the filters.':'');
  renderTrend(data.metrics);
  const value = el('version').value;
  el('version').replaceChildren(
    new Option('All versions', ''),
    ...data.versions.map((v) => new Option(v.version, v.version)),
  );
  if(value && !data.versions.some(v=>v.version===value))el('version').add(new Option(value,value));
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
    s.textContent = sum(name).toLocaleString();
    d.className = 'metric';
    d.append(s, label);
    el('summary').append(d);
  }
  const releases = new Map(),
    events = new Map();
  for (const m of data.metrics) {
    const k = m.version + ' / ' + m.channel + ' / ' + m.os;
    if (!releases.has(k)) releases.set(k, [m.version, displayName(m.channel), ({windows:'Windows',macos:'macOS',linux:'Linux'})[m.os]||m.os, 0, 0, 0]);
    const r = releases.get(k);
    if (m.name === 'app_opened') r[3] += m.count;
    if (m.name === 'task_state' && m.dimension === 'starting') r[4] += m.count;
    if (m.name === 'app_error') r[5] += m.count;
    if (m.name === 'feature_used' || m.name === 'app_error') {
      const k = (m.name==='app_error'?'Error':'Feature use') + ' / ' + displayName(m.dimension);
      events.set(k, (events.get(k) || 0) + m.count);
    }
  }
  table(
    'releases',
    ['Version', 'Channel', 'OS', 'Opens', 'Tasks started', 'Errors'],
    [...releases.values()].sort((a,b)=>b[3]-a[3]),
  );
  table(
    'events',
    ['Event / category', 'Count'],
    [...events.entries()].sort((a, b) => b[1] - a[1]),
  );
}
function displayName(value){return value.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());}
async function inbox(append = false) {
  if(!append){el('inbox').replaceChildren();el('more').hidden=true;cursor=null;}
  el('inbox-count').textContent='Loading reports…';
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
    a.className='feedback-report';
    h.textContent =
      displayName(report.kind || 'feedback') +
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
    select.onchange = () => {
      const nextStatus = select.value;
      select.value = row.status;
      run(async () => {
        const result = await api('/admin/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: row.id, status: nextStatus }),
        });
        if(!result.updated){select.value=row.status;throw Error('This report is no longer available. Refresh the inbox.');}
        await inbox();
        el('inbox-count').textContent='Report status updated.';
        el('status').focus();
      }, 'inbox-error');
    };
    label.append(select);
    a.append(h, meta, text, label);
    el('inbox').append(a);
  }
  if (!el('inbox').children.length) {const empty=document.createElement('p');empty.className='empty';empty.textContent='You’re all caught up. No reports in this view.';el('inbox').append(empty);}
  el('inbox-count').textContent=el('inbox').querySelectorAll('article').length+' reports shown';
  cursor = data.reports.at(-1)?.cursor;
  el('more').hidden = data.reports.length < 50;
}
async function run(fn, errorId = 'error') {
  if (busy) return;
  busy = true;
  el(errorId).textContent = '';
  const controls=[...document.querySelectorAll('[data-view=activity] button,[data-view=activity] select,[data-view=feedback] button,[data-view=feedback] select')];
  controls.forEach((e) => (e.disabled = true));
  try {
    await fn();
  } catch (e) {
    el(errorId).textContent = e.message;
    if(errorId==='inbox-error')el('inbox-count').textContent='Request failed. Refresh or try again.';
    if(errorId==='error'){el('activity-updated').textContent='Activity unavailable for this selection. Refresh to try again.';for(const id of ['summary','trend','releases','events'])el(id).replaceChildren();}
  } finally {
    busy = false;
    controls.forEach((e) => (e.disabled = false));
  }
}
el('refresh').onclick = () => run(overview);
for (const id of ['days', 'channel', 'version']) el(id).onchange = () => run(overview);
el('status').onchange = () => run(() => inbox(), 'inbox-error');
el('more').onclick = () => run(() => inbox(true), 'inbox-error');
el('refresh-inbox').onclick = () => run(() => inbox(), 'inbox-error');
function element(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function linkRow(title,description,href){const a=element('a',undefined,'quick-link');a.href=href;const content=element('div');content.append(element('strong',title),element('small',description));a.append(content,element('span','→'));return a;}
async function home(){
 el('refresh-home').disabled=true;el('home-error').textContent='';el('home-updated').textContent='Refreshing dashboard…';
 const results=await Promise.allSettled([api('/admin/api/summary'),api('/admin/api/access/readiness')]);
 const [summary,readiness]=results;
 if(summary.status==='fulfilled'){
  const {people,feedback,mail}=summary.value;const fresh=feedback.find(r=>r.status==='new')?.count||0;
  el('people-summary').replaceChildren();
  for(const [label,value,detail,url] of [['Waiting for access',people.waiting,'Review waitlist','/admin/access#people'],['Approved accounts',people.approved,'Manage people','/admin/access?status=approved#people'],['Desktop connected',people.connected,'View connections','/admin/access?status=approved&stage=connected#people'],['New feedback',fresh,'Open inbox','/admin#feedback']]){
   const metric=element('div',undefined,'metric');const a=element('a',detail+' →');a.href=url;metric.append(element('span',label),element('strong',Number(value).toLocaleString()),a);el('people-summary').append(metric);
  }
  el('attention').replaceChildren(
   linkRow(people.waiting+' waiting for approval','Review requests in waitlist priority order.','/admin/access#people'),
   linkRow(people.notSignedIn+' approved, awaiting sign-in','Check their invitation and delivery history.','/admin/access?stage=not-signed-in#people'),
   linkRow(people.notConnected+' signed in, no desktop yet','Follow up on the next onboarding step.','/admin/access?stage=not-connected#people'),
   linkRow(mail.needsAttention+' emails need attention','Latest account email failed or received a delivery warning.','/admin/access?stage=email-failed#people'));
  el('home-updated').textContent='Updated '+new Date().toLocaleTimeString()+' · Account totals exclude revoked access. Connections reflect first desktop sign-in.';
 }else{el('home-error').textContent=summary.reason.message;el('home-updated').textContent='Dashboard unavailable. Refresh to try again.';el('people-summary').replaceChildren();el('attention').replaceChildren(element('p','Follow-ups could not be loaded.'));}
 el('service').replaceChildren();el('service-error').textContent='';
 if(readiness.status==='fulfilled'){
  const r=readiness.value;
  for(const [label,value] of [['Early access',r.enabled?'Enabled':'Disabled'],['Account email',r.mailConfigured?'Configured':'Needs setup'],[r.distribution==='store'?'Microsoft Store':'Private installer',r.distribution==='store'?'Link configured':r.download==='available'?(r.version||'Available'):r.download==='missing'?'File missing':r.download==='unknown'?'Could not check':'Not configured']]){const row=element('div');row.append(element('dt',label),element('dd',value));el('service').append(row);}
 }else{el('service-error').textContent=readiness.reason.message;}
 el('refresh-home').disabled=false;
}
function renderTrend(metrics){
 const days=Number(el('days').value),totals=new Map();
 for(const m of metrics)if(m.name==='app_opened')totals.set(m.day,(totals.get(m.day)||0)+m.count);
 const chart=element('div',undefined,'spark-chart');const max=Math.max(1,...totals.values());const dates=[];
 for(let offset=days-1;offset>=0;offset--){const day=new Date(Date.now()-offset*86400000).toISOString().slice(0,10);dates.push(day);const count=totals.get(day)||0;const item=element('div',undefined,'spark-day');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 100');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label',day+': '+count+' reported app opens');const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=day+': '+count+' opens';const bar=document.createElementNS(svg.namespaceURI,'rect');bar.setAttribute('x','2');bar.setAttribute('width','16');bar.setAttribute('rx','3');const height=Math.max(2,count/max*96);bar.setAttribute('y',String(100-height));bar.setAttribute('height',String(height));bar.setAttribute('fill',count?'var(--color-accent)':'var(--color-border-subtle)');svg.append(title,bar);item.append(svg);chart.append(item);}
 const labels=element('div',undefined,'spark-labels');labels.append(element('span',dates[0]),element('span','Peak '+(max===1&&!totals.size?0:Math.max(0,...totals.values()))+' opens / day'),element('span',dates.at(-1)));el('trend').replaceChildren(chart,labels);
 if(!totals.size)el('trend').prepend(element('p','No app-open events reported in this selection.','notice'));
}
el('refresh-home').onclick=()=>void home();
void home();
run(overview).then(()=>run(()=>inbox(),'inbox-error'));
</script></body></html>`;
}
