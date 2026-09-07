import { PRESET_THEMES, themeTokens } from '@jackalope/brand/tokens';
import { z } from 'zod';
import { randomToken } from './crypto';
import { accessEmail } from './mail';
import { approve, requestLink } from './service';

export async function accessAdmin(
  request: Request,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
) {
  const url = new URL(request.url);
  const headers = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  };
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  if (request.method === 'GET' && url.pathname === '/admin/access') {
    const nonce = crypto.randomUUID();
    return new Response(accessAdminPage(nonce), {
      headers: {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    });
  }
  if (request.method === 'GET' && url.pathname === '/admin/access/email-preview') {
    return new Response(
      accessEmail(
        { to: 'preview@example.invalid', kind: 'welcome', token: 'preview-only-not-a-login-token' },
        env.ACCESS_WEB_ORIGIN,
      ).body,
      {
        headers: {
          ...headers,
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'; img-src https://jackalope.dev; base-uri 'none'; frame-ancestors 'none'",
        },
      },
    );
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/access') {
    const status = url.searchParams.get('status') ?? 'waiting';
    const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
    if (
      !['waiting', 'approved', 'revoked'].includes(status) ||
      !Number.isSafeInteger(before) ||
      before < 0 ||
      query.length > 254
    )
      return json({ error: 'invalid_filter' }, 400);
    const members = await env.DB.prepare(
      "SELECT rowid AS cursor,id,email,status,created_at,approved_at,newsletter,newsletter_synced_at,newsletter_attempts,(SELECT email FROM access_members i WHERE i.id=m.invited_by) AS invited_by,(SELECT count(*) FROM access_invites WHERE owner_id=m.id AND status='accepted') AS accepted,(SELECT state FROM access_mail WHERE email=m.email ORDER BY created_at DESC LIMIT 1) AS mail_state FROM access_members m WHERE status=? AND rowid<? AND instr(email,?)>0 ORDER BY rowid DESC LIMIT 50",
    )
      .bind(status, before, query)
      .all();
    const counts = await env.DB.prepare(
      'SELECT status,count(*) AS count FROM access_members GROUP BY status',
    ).all();
    return json({
      members: members.results,
      counts: counts.results,
      enabled: env.EARLY_ACCESS_ENABLED === 'true',
    });
  }
  if (request.method === 'POST' && url.pathname === '/admin/api/access') {
    if (request.headers.get('origin') !== url.origin)
      return json({ error: 'origin_required' }, 403);
    if (
      env.EARLY_ACCESS_ENABLED !== 'true' ||
      !env.ACCESS_SECRET ||
      !env.SEQUENZY_API_KEY ||
      !env.ACCESS_EMAIL_FROM
    )
      return json({ error: 'access_not_configured' }, 503);
    const parsed = z
      .strictObject({ id: z.uuid(), action: z.enum(['approve', 'resend', 'revoke', 'restore']) })
      .safeParse(await readJson(request));
    if (!parsed.success) return json({ error: 'invalid_request' }, 400);
    const { id, action } = parsed.data;
    const member = await env.DB.prepare('SELECT email,status FROM access_members WHERE id=?')
      .bind(id)
      .first<{ email: string; status: string }>();
    if (!member) return json({ error: 'member_not_found' }, 404);
    if (action === 'approve') await approve(env, id);
    else if (action === 'resend' && member.status === 'approved')
      await requestLink(env, member.email);
    else if (action === 'restore' && member.status === 'revoked')
      await env.DB.prepare(
        "UPDATE access_members SET status='waiting',approved_at=NULL,verified_at=NULL,share_code=? WHERE id=? AND status='revoked'",
      )
        .bind(randomToken(), id)
        .run();
    else if (action === 'revoke')
      await env.DB.batch([
        env.DB.prepare("UPDATE access_members SET status='revoked' WHERE id=?").bind(id),
        env.DB.prepare('DELETE FROM access_sessions WHERE member_id=?').bind(id),
        env.DB.prepare('DELETE FROM access_tokens WHERE email=?').bind(member.email),
        env.DB.prepare(
          "UPDATE access_invites SET status='revoked' WHERE (owner_id=? OR email=?) AND status='pending'",
        ).bind(id, member.email),
      ]);
    return json({ success: true });
  }
  return json({ error: 'not_found' }, 404);
}
const colors = (isDark: boolean) =>
  Object.entries(themeTokens({ ...PRESET_THEMES[0], isDark }))
    .map(([k, v]) => `${k}:${v};`)
    .join('');
function accessAdminPage(nonce: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Early access · Jackalope</title><style nonce="${nonce}">
:root{${colors(false)}}@media(prefers-color-scheme:dark){:root{${colors(true)}}}*{box-sizing:border-box}body{margin:0;background:var(--color-surface);color:var(--color-text-primary);font:15px/1.6 system-ui}main{max-width:1080px;margin:auto;padding:40px 24px}a{color:var(--color-accent-ink)}h1{font-size:clamp(32px,5vw,48px);letter-spacing:-.04em;margin:16px 0}p,small{color:var(--color-text-secondary)}nav,.filters,.actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,input,select{font:inherit;color:inherit;min-height:44px;padding:9px 14px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface)}button{cursor:pointer}button.primary{background:var(--color-accent);color:var(--color-on-accent);border-color:transparent}button:disabled{opacity:.5;cursor:wait}:focus-visible{outline:2px solid var(--color-accent-ink);outline-offset:3px}.filters{margin:32px 0}label{display:grid;gap:5px}article{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:center;padding:24px 0;border-top:1px solid var(--color-border)}article strong{overflow-wrap:anywhere}article p{margin:6px 0;font-size:13px}.badge{color:var(--color-accent-ink);font-size:12px;letter-spacing:.1em}#notice{min-height:24px}#more{margin-top:24px}@media(max-width:600px){article{grid-template-columns:1fr}.filters>*{width:100%}}[hidden]{display:none}
</style></head><body><main><nav><a href="/admin">Release observatory</a><a href="/admin/access/email-preview" target="_blank" rel="noreferrer">Preview welcome email</a></nav><header><p class="badge">JACKALOPE / PRIVATE</p><h1>Make a little room.</h1><p>Approve people from the waitlist. They receive a private access link and five invitations of their own. Email reservations expire after seven days; accepted places stay counted.</p><p id="counts"></p></header><div class="filters"><label>People<select id="status"><option value="waiting">Waiting for approval</option><option value="approved">Approved</option><option value="revoked">Revoked</option></select></label><label>Find an email<input id="query" type="search" maxlength="254" placeholder="Email address"></label><button id="search">Find people</button></div><p id="notice" role="status" aria-live="polite"></p><div id="members"></div><button id="more" hidden>Load more</button></main><script nonce="${nonce}">
const $=id=>document.getElementById(id);let cursor=null,busy=false;
async function load(append=false){if(busy)return;busy=true;$('notice').textContent='Loading…';try{const p=new URLSearchParams({status:$('status').value,query:$('query').value});if(append&&cursor)p.set('before',cursor);const r=await fetch('/admin/api/access?'+p);if(!r.ok)throw Error('Could not load people. Refresh your private sign-in and try again.');const data=await r.json();if(!append)$('members').replaceChildren();$('counts').textContent=data.counts.map(x=>x.count+' '+x.status).join(' · ');for(const person of data.members){const row=document.createElement('article'),info=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('p'),actions=document.createElement('div');name.textContent=person.email;detail.textContent='Requested '+new Date(person.created_at).toLocaleDateString()+(person.invited_by?' · Invited by '+person.invited_by:'')+' · '+person.accepted+' accepted invitations'+(person.mail_state?' · Email '+person.mail_state:'')+(person.newsletter&&person.newsletter_synced_at===null?' · Product notes '+(person.newsletter_attempts>=5?'need attention':'pending sync'):'');info.append(name,detail);actions.className='actions';const choices=person.status==='waiting'?[['approve','Approve & email']]:person.status==='approved'?[['resend','Send access link'],['revoke','Revoke access']]:[['restore','Return to waitlist']];for(const [action,label] of choices){const button=document.createElement('button');button.textContent=label;button.disabled=!data.enabled;if(action==='approve')button.className='primary';button.onclick=async()=>{if(action==='revoke'&&!confirm('Revoke access for '+person.email+'? Their accepted invitees keep their own access.'))return;button.disabled=true;try{const result=await fetch('/admin/api/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:person.id,action})});if(!result.ok)throw Error('Could not update access. Check the service and try again.');await load();$('notice').textContent=action==='approve'?'Approved. The welcome email is queued.':action==='resend'?'Access link requested. Recent requests are limited to prevent duplicate emails.':'Access updated.';}catch(e){$('notice').textContent=e.message;button.disabled=false;}};actions.append(button);}row.append(info,actions);$('members').append(row);}cursor=data.members.at(-1)?.cursor;$('more').hidden=data.members.length<50;$('notice').textContent=!data.enabled?'Early access is disabled. Configure the service before approving people.':!data.members.length?'No people match this view.':'';}catch(e){$('notice').textContent=e.message;}finally{busy=false;}}
$('status').onchange=()=>load();$('search').onclick=()=>load();$('query').onkeydown=e=>{if(e.key==='Enter')load();};$('more').onclick=()=>load(true);load();
</script></body></html>`;
}
