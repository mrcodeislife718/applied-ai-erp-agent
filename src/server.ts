import express from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { auditFor } from './audit.js';
import { runAgent } from './agent.js';
import { createMcpServer } from './mcp.js';

const app = express();
app.use(express.json());

app.post('/api/agent', (req, res) => {
  const input = typeof req.body?.input === 'string' ? req.body.input : '';
  const approved = req.body?.approved === true;
  res.json(runAgent(input, { approved }));
});

app.get('/api/audit/:requestId', (req, res) => {
  res.json({ requestId: req.params.requestId, records: auditFor(req.params.requestId) });
});

const mcpHandler = createMcpHandler(() => createMcpServer());
app.all('/mcp', toNodeHandler(mcpHandler));

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Applied AI ERP Agent</title>
<style>
body{font-family:Inter,system-ui,sans-serif;margin:0;background:#0b1020;color:#eef2ff}.wrap{max-width:1180px;margin:auto;padding:40px 20px}.hero{margin-bottom:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:#151c31;border:1px solid #2a3557;border-radius:16px;padding:18px}textarea{width:100%;min-height:120px;background:#0d1428;color:#fff;border:1px solid #344264;border-radius:12px;padding:12px;box-sizing:border-box}button{margin-top:12px;padding:11px 16px;border:0;border-radius:10px;font-weight:700;cursor:pointer}.secondary{margin-left:8px}.tag{display:inline-block;padding:4px 8px;border-radius:999px;background:#26365e;margin-right:6px;font-size:12px}pre{white-space:pre-wrap;word-break:break-word;font-size:12px}.component{border-left:3px solid #7dd3fc;padding-left:12px;margin:12px 0}.muted{color:#9ca9c9}.ok{color:#86efac}.warn{color:#fbbf24}@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap"><div class="hero"><span class="tag">Remote MCP</span><span class="tag">Grounded</span><span class="tag">Approval-gated</span><span class="tag">Fault-tested</span><h1>Applied AI ERP Agent</h1><p class="muted">A compact proof of intent-routed, tool-using ERP automation over synthetic manufacturing data.</p></div>
<div class="grid"><div class="card"><h2>Ask the agent</h2><textarea id="input">We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.</textarea><br><button onclick="run(false)">Analyze safely</button><button class="secondary" onclick="run(true)">Approve proposed transfer</button><div id="answer"></div><div id="status"></div></div><div class="card"><h2>Typed UI</h2><div id="components" class="muted">Run the scenario to render validated response components.</div></div><div class="card"><h2>Execution trace</h2><pre id="trace" class="muted">Intent → scope → tools → authority → verification</pre></div><div class="card"><h2>Audit evidence</h2><p class="muted">Every run gets a request ID. The append-only audit endpoint exposes the same safety-relevant stages independently of the UI.</p><pre id="audit">No run yet.</pre><p><b>Remote MCP endpoint:</b> <code>/mcp</code></p></div></div></div>
<script>
async function run(approved){const input=document.getElementById('input').value;const r=await fetch('/api/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input,approved})});const d=await r.json();document.getElementById('answer').innerHTML='<h3>Answer</h3><p>'+esc(d.answer)+'</p>';document.getElementById('status').innerHTML='<p class="'+(d.degraded?'warn':'ok')+'">'+(d.degraded?'DEGRADED / WRITES BLOCKED':'NORMAL / SAFETY POLICY ACTIVE')+' · '+esc(d.requestId)+'</p>';document.getElementById('components').innerHTML=d.components.map(c=>'<div class="component"><b>'+esc(c.type)+'</b><pre>'+esc(JSON.stringify(c.props,null,2))+'</pre></div>').join('')||'<span class="muted">No components: request was not grounded.</span>';document.getElementById('trace').textContent=JSON.stringify(d.trace,null,2);const a=await fetch('/api/audit/'+encodeURIComponent(d.requestId));document.getElementById('audit').textContent=JSON.stringify(await a.json(),null,2)}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
</script></body></html>`);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Applied AI ERP Agent running at http://localhost:${port}`));
