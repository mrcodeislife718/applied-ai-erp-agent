import express, { type Request, type Response, type NextFunction } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { auditFor, auditStats, verifyAuditChain } from './audit.js';
import { issueSession, principalFromAuthorization, runAsPrincipal, type Principal, type Role } from './auth.js';
import { runAgent } from './agent.js';
import { erp } from './data.js';
import { createMcpServer } from './mcp-server.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
  next();
});

const windows = new Map<string, { count: number; resetAt: number }>();
app.use('/api', (req, res, next) => {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) windows.set(key, { count: 1, resetAt: now + 60_000 });
  else if (++entry.count > 120) return res.status(429).json({ error: 'rate_limit_exceeded' });
  next();
});

function requirePrincipal(req: Request, res: Response): Principal | null {
  const principal = principalFromAuthorization(req.headers.authorization);
  if (!principal) res.status(401).json({ error: 'valid_bearer_session_required' });
  return principal;
}

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'applied-ai-erp-agent', version: '1.0.0' }));

app.post('/api/demo/session', (req, res) => {
  if (process.env.DEMO_MODE === 'false') return res.status(404).json({ error: 'demo_sessions_disabled' });
  const allowed: Role[] = ['viewer', 'planner', 'operator', 'finance-approver'];
  const role = allowed.includes(req.body?.role) ? req.body.role as Role : 'operator';
  const principal = { id: `demo-${role}`, role };
  res.json({ token: issueSession(principal), principal, expiresInSeconds: 900 });
});

app.post('/api/agent', (req, res) => {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  const input = typeof req.body?.input === 'string' ? req.body.input.slice(0, 4000) : '';
  const approved = req.body?.approved === true;
  res.json(runAgent(input, { approved, principal }));
});

app.get('/api/audit/:requestId', (req, res) => {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  res.json({ requestId: req.params.requestId, chainValid: verifyAuditChain(), records: auditFor(req.params.requestId) });
});

app.get('/api/metrics', (req, res) => {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  res.json({ audit: auditStats(), auditChainValid: verifyAuditChain(), erp: { transfers: erp.transfers.length, financialActions: erp.financialActions.length } });
});

app.get('/api/state', (req, res) => {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  res.json({ orders: erp.orders, inventory: erp.inventory, purchaseOrders: erp.purchaseOrders, production: erp.production, invoices: erp.invoices, transfers: erp.transfers, financialActions: erp.financialActions });
});

const mcpNodeHandler = toNodeHandler(createMcpHandler(() => createMcpServer()));
app.all('/mcp', (req: Request, res: Response, _next: NextFunction) => {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  return runAsPrincipal(principal, () => mcpNodeHandler(req, res));
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Applied AI ERP Agent</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;margin:0;background:#080d19;color:#eef2ff}.wrap{max-width:1240px;margin:auto;padding:38px 20px 70px}.hero{display:flex;gap:24px;justify-content:space-between;align-items:flex-end;margin-bottom:24px}.eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#7dd3fc}.hero h1{font-size:clamp(34px,5vw,58px);line-height:1;margin:8px 0}.hero p{max-width:760px;color:#aab6d3;font-size:17px}.tags{display:flex;flex-wrap:wrap;gap:7px}.tag{padding:5px 9px;border:1px solid #32436a;border-radius:999px;background:#17213a;font-size:12px}.grid{display:grid;grid-template-columns:1.08fr .92fr;gap:18px}.card{background:linear-gradient(180deg,#121a2d,#0f1728);border:1px solid #263452;border-radius:18px;padding:20px;box-shadow:0 14px 40px rgba(0,0,0,.18)}.wide{grid-column:1/-1}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}select,textarea,button{font:inherit}select,textarea{background:#091123;color:#fff;border:1px solid #344264;border-radius:11px;padding:11px}textarea{width:100%;min-height:118px;resize:vertical}button{padding:10px 14px;border:1px solid #526a9e;border-radius:10px;background:#e8eefc;color:#10182a;font-weight:750;cursor:pointer}button.secondary{background:#17213a;color:#eef2ff}button.scenario{font-size:12px;padding:8px 10px}.muted{color:#91a0c0}.ok{color:#86efac}.warn{color:#fbbf24}.bad{color:#fca5a5}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:420px;overflow:auto}.component{border-left:3px solid #7dd3fc;padding:9px 12px;margin:10px 0;background:#0b1426;border-radius:0 10px 10px 0}.trust{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.trust div{background:#0d1527;border:1px solid #263452;border-radius:13px;padding:13px}.trust b{display:block;margin-bottom:4px}@media(max-width:850px){.grid{grid-template-columns:1fr}.hero{display:block}.wide{grid-column:auto}.trust{grid-template-columns:1fr 1fr}}
</style></head><body><div class="wrap"><div class="hero"><div><div class="eyebrow">AI-first manufacturing ERP engineering proof</div><h1>Applied AI ERP Agent</h1><p>Grounded agents with scoped MCP tools, role-based authority, explicit approvals, idempotent writes, optimistic concurrency, independent verification, fail-closed reliability, and tamper-evident audit evidence.</p><div class="tags"><span class="tag">Remote MCP</span><span class="tag">Typed tools</span><span class="tag">RBAC</span><span class="tag">Idempotency</span><span class="tag">Concurrency</span><span class="tag">Evals</span></div></div></div>
<div class="trust"><div><b>Grounding</b><span class="muted">No missing ERP state is invented.</span></div><div><b>Authority</b><span class="muted">Identity + role + explicit approval.</span></div><div><b>Verification</b><span class="muted">Writes checked against resulting state.</span></div><div><b>Audit</b><span class="muted">SHA-256 chained execution evidence.</span></div></div>
<div class="grid"><div class="card"><h2>Run a workflow</h2><div class="row"><label>Actor role <select id="role"><option value="operator">Operator</option><option value="viewer">Viewer</option><option value="planner">Planner</option><option value="finance-approver">Finance approver</option></select></label><button class="scenario secondary" onclick="scenario('inventory')">Inventory shortage</button><button class="scenario secondary" onclick="scenario('manufacturing')">Manufacturing</button><button class="scenario secondary" onclick="scenario('financial')">Financial</button></div><p></p><textarea id="input">We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.</textarea><div class="row"><button onclick="run(false)">Analyze safely</button><button class="secondary" onclick="run(true)">Approve / execute</button></div><div id="answer"></div><div id="status"></div></div>
<div class="card"><h2>Typed AI-native UI</h2><div id="components" class="muted">Run a scenario to render constrained component descriptors.</div></div>
<div class="card"><h2>Execution trace</h2><pre id="trace" class="muted">identity → intent → scope → tools → policy → execution → verification</pre></div>
<div class="card"><h2>Tamper-evident audit</h2><pre id="audit" class="muted">No run yet.</pre></div>
<div class="card wide"><h2>What this demonstrates</h2><div class="row"><span class="tag">Inventory transfers require operator authority</span><span class="tag">Invoice approvals require finance-approver</span><span class="tag">Duplicate requests are idempotent</span><span class="tag">Stale versions fail safely</span><span class="tag">Tool outages fail closed</span><span class="tag">MCP writes inherit authenticated identity</span></div><p class="muted">Synthetic ERP data only. This is an engineering showcase, not a claim of production customer traffic. Remote MCP is available at <code>/mcp</code> and requires the same signed bearer session as the API.</p></div></div></div>
<script>
let token='';async function session(){const role=document.getElementById('role').value;const r=await fetch('/api/demo/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role})});const d=await r.json();token=d.token;return d.principal}document.getElementById('role').addEventListener('change',()=>{token=''})
function scenario(kind){const i=document.getElementById('input');if(kind==='inventory')i.value='We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.';if(kind==='manufacturing')i.value='Show me the current production status for manufacturing order MO-92.';if(kind==='financial')i.value='Review and approve invoice INV-300.'}
async function run(approved){const principal=await session();const input=document.getElementById('input').value;const r=await fetch('/api/agent',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify({input,approved})});const d=await r.json();if(!r.ok){document.getElementById('status').innerHTML='<p class="bad">'+esc(JSON.stringify(d))+'</p>';return}document.getElementById('answer').innerHTML='<h3>Agent answer</h3><p>'+esc(d.answer)+'</p>';document.getElementById('status').innerHTML='<p class="'+(d.degraded?'warn':'ok')+'">'+(d.degraded?'DEGRADED / WRITES BLOCKED':'POLICY ACTIVE')+' · '+esc(principal.id)+' ('+esc(principal.role)+') · '+esc(d.requestId)+'</p>';document.getElementById('components').innerHTML=d.components.map(c=>'<div class="component"><b>'+esc(c.type)+'</b><pre>'+esc(JSON.stringify(c.props,null,2))+'</pre></div>').join('')||'<span class="muted">No typed components returned.</span>';document.getElementById('trace').textContent=JSON.stringify(d.trace,null,2);const a=await fetch('/api/audit/'+encodeURIComponent(d.requestId),{headers:{authorization:'Bearer '+token}});document.getElementById('audit').textContent=JSON.stringify(await a.json(),null,2)}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
</script></body></html>`);
});

export default app;

if (process.env.VERCEL !== '1') {
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`Applied AI ERP Agent running at http://localhost:${port}`));
}
