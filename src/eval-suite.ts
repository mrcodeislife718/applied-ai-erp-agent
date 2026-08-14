import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditFor, configureAuditFile, resetAudit, verifyAuditChain } from './audit.js';
import { issueSession, verifySession, type Principal } from './auth.js';
import { runAgent, runAgentWithProvider } from './agent.js';
import { resetErp, erp } from './data.js';
import { DeterministicProvider } from './provider.js';
import { FaultInjector } from './reliability.js';
import { routeIntent } from './router.js';
import { scopedTools, tools } from './tools.js';

const operator: Principal = { id: 'operator-1', role: 'operator' };
const viewer: Principal = { id: 'viewer-1', role: 'viewer' };
const finance: Principal = { id: 'finance-1', role: 'finance-approver' };

type EvalCase = { name: string; run: () => void | Promise<void> };

const cases: EvalCase[] = [
  { name: 'routes inventory intent', run: () => assert.equal(routeIntent('SO-1842 is short inventory'), 'inventory') },
  { name: 'routes manufacturing intent', run: () => assert.equal(routeIntent('production order MO-92'), 'manufacturing') },
  { name: 'routes financial intent', run: () => assert.equal(routeIntent('approve invoice INV-300'), 'financials') },
  { name: 'refuses nonexistent order', run: () => assert.match(runAgent('Check shortage on SO-9999').answer, /will not invent/i) },
  { name: 'requires order reference', run: () => assert.equal(runAgent('We may be short on this order').grounded, false) },
  { name: 'analysis proposes but does not execute', run: () => {
    const result = runAgent('SO-1842 inventory shortage', { principal: operator });
    assert.ok(result.components.some(c => c.type === 'ApprovalRequest'));
    assert.equal(result.trace.some(t => t.stage === 'execution'), false);
  } },
  { name: 'authorized transfer mutates and verifies state', run: () => {
    const beforeSource = erp.inventory['NJ-2:AX-440'].onHand;
    const beforeDest = erp.inventory['NYC-1:AX-440'].onHand;
    const result = runAgent('SO-1842 inventory shortage', { approved: true, principal: operator });
    assert.equal(erp.inventory['NJ-2:AX-440'].onHand, beforeSource - 220);
    assert.equal(erp.inventory['NYC-1:AX-440'].onHand, beforeDest + 220);
    assert.ok(result.trace.some(t => t.stage === 'verification' && (t.detail as { verified?: boolean }).verified === true));
  } },
  { name: 'viewer cannot execute transfer', run: () => {
    const result = tools.executeTransfer({ sku: 'AX-440', quantity: 1, from: 'NJ-2', to: 'NYC-1', approved: true, idempotencyKey: 'viewer-key-001' }, viewer);
    assert.equal(result.ok, false);
    assert.equal(erp.transfers.length, 0);
  } },
  { name: 'explicit approval is mandatory', run: () => {
    const result = tools.executeTransfer({ sku: 'AX-440', quantity: 1, from: 'NJ-2', to: 'NYC-1', approved: false, idempotencyKey: 'approval-key-001' }, operator);
    assert.deepEqual(result, { ok: false, reason: 'approval_required' });
  } },
  { name: 'insufficient inventory is rejected', run: () => {
    const result = tools.executeTransfer({ sku: 'AX-440', quantity: 999, from: 'NJ-2', to: 'NYC-1', approved: true, idempotencyKey: 'stock-key-0001' }, operator);
    assert.equal(result.ok, false);
  } },
  { name: 'idempotency prevents duplicate mutation', run: () => {
    const args = { sku: 'AX-440', quantity: 10, from: 'NJ-2', to: 'NYC-1', approved: true, idempotencyKey: 'idempotent-0001' };
    const first = tools.executeTransfer(args, operator);
    const afterFirst = erp.inventory['NJ-2:AX-440'].onHand;
    const second = tools.executeTransfer(args, operator);
    assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(erp.inventory['NJ-2:AX-440'].onHand, afterFirst); assert.equal(erp.transfers.length, 1);
  } },
  { name: 'idempotency key reuse with different action is rejected', run: () => {
    tools.executeTransfer({ sku: 'AX-440', quantity: 10, from: 'NJ-2', to: 'NYC-1', approved: true, idempotencyKey: 'conflict-key-001' }, operator);
    const second = tools.executeTransfer({ sku: 'AX-440', quantity: 11, from: 'NJ-2', to: 'NYC-1', approved: true, idempotencyKey: 'conflict-key-001' }, operator);
    assert.equal(second.ok, false);
  } },
  { name: 'optimistic concurrency rejects stale inventory version', run: () => {
    const result = tools.executeTransfer({ sku: 'AX-440', quantity: 1, from: 'NJ-2', to: 'NYC-1', approved: true, idempotencyKey: 'version-key-001', expectedSourceVersion: 999 }, operator);
    assert.equal(result.ok, false); assert.equal(erp.transfers.length, 0);
  } },
  { name: 'inventory domain scopes its tool surface', run: () => assert.ok(scopedTools('inventory').includes('executeTransfer')) },
  { name: 'transient timeout recovers within retry budget', run: () => {
    const result = runAgent('SO-1842 inventory shortage', { principal: operator, faults: new FaultInjector({ getInventory: ['timeout', 'none'] }) });
    const attempts = result.trace.filter(t => t.stage === 'tool_attempt' && (t.detail as { name?: string }).name === 'getInventory');
    assert.equal(result.grounded, true); assert.equal(attempts.length, 2);
  } },
  { name: 'persistent dependency outage fails closed', run: () => {
    const result = runAgent('SO-1842 inventory shortage', { approved: true, principal: operator, faults: new FaultInjector({ getSupplyOptions: ['unavailable', 'unavailable'] }) });
    assert.equal(result.degraded, true); assert.equal(erp.transfers.length, 0);
  } },
  { name: 'execute-tool outage causes zero mutation', run: () => {
    const result = runAgent('SO-1842 inventory shortage', { approved: true, principal: operator, faults: new FaultInjector({ executeTransfer: ['timeout', 'timeout'] }) });
    assert.equal(result.degraded, true); assert.equal(erp.transfers.length, 0);
  } },
  { name: 'malformed tool result fails closed', run: () => {
    const result = runAgent('SO-1842 inventory shortage', { principal: operator, faults: new FaultInjector({ getInventory: ['malformed'] }) });
    assert.equal(result.degraded, true);
  } },
  { name: 'audit contains identity intent and final stages', run: () => {
    const result = runAgent('SO-1842 inventory shortage', { principal: operator });
    const records = auditFor(result.requestId);
    assert.ok(records.some(r => r.stage === 'identity')); assert.ok(records.some(r => r.stage === 'intent')); assert.ok(records.some(r => r.stage === 'final'));
  } },
  { name: 'audit hash chain verifies', run: () => { runAgent('SO-1842 inventory shortage', { principal: operator }); assert.equal(verifyAuditChain(), true); } },
  { name: 'audit can persist as NDJSON', run: () => {
    const path = join(tmpdir(), `erp-agent-audit-${process.pid}.ndjson`);
    configureAuditFile(path); resetAudit(); runAgent('SO-1842 inventory shortage', { principal: operator });
    assert.equal(existsSync(path), true); assert.match(readFileSync(path, 'utf8'), /"hash"/); configureAuditFile(null); rmSync(path, { force: true });
  } },
  { name: 'manufacturing workflow is grounded', run: () => {
    const result = runAgent('Show production order MO-92', { principal: viewer });
    assert.equal(result.grounded, true); assert.ok(result.components.some(c => c.type === 'ProductionStatus'));
  } },
  { name: 'manufacturing workflow requires reference', run: () => assert.equal(runAgent('Show production status', { principal: viewer }).grounded, false) },
  { name: 'financial workflow requires explicit approval', run: () => {
    const result = runAgent('Approve invoice INV-300', { principal: finance });
    assert.ok(result.components.some(c => c.type === 'ApprovalRequest')); assert.equal(erp.invoices['INV-300'].status, 'pending');
  } },
  { name: 'operator cannot approve invoice', run: () => {
    const result = runAgent('Approve invoice INV-300', { approved: true, principal: operator });
    assert.equal(erp.invoices['INV-300'].status, 'pending'); assert.ok(result.components.some(c => c.type === 'SystemNotice'));
  } },
  { name: 'finance approver can approve and verify invoice', run: () => {
    const result = runAgent('Approve invoice INV-300', { approved: true, principal: finance });
    assert.equal(erp.invoices['INV-300'].status, 'approved'); assert.ok(result.trace.some(t => t.stage === 'verification'));
  } },
  { name: 'signed session preserves principal', run: () => assert.deepEqual(verifySession(issueSession(finance)), finance) },
  { name: 'expired session is rejected', run: () => assert.equal(verifySession(issueSession(viewer, 0)), null) },
  { name: 'valid structured model decision executes grounded analysis', run: async () => assert.equal((await runAgentWithProvider('SO-1842 inventory shortage', new DeterministicProvider('inventory'), { principal: operator })).grounded, true) },
  { name: 'malformed model decision is blocked before tools', run: async () => {
    const result = await runAgentWithProvider('SO-1842 inventory shortage', new DeterministicProvider('inventory', true), { approved: true, principal: operator });
    assert.equal(result.degraded, true); assert.equal(erp.transfers.length, 0); assert.ok(result.trace.some(t => t.stage === 'model_validation'));
  } },
  { name: 'unknown intent does not expose arbitrary tools', run: () => {
    const result = runAgent('tell me something unrelated', { principal: viewer });
    assert.equal(result.grounded, false); assert.equal(result.domain, 'unknown');
  } }
];

export async function runEvaluationSuite() {
  const started = Date.now();
  const failures: Array<{ name: string; error: string }> = [];
  let passed = 0;
  for (const test of cases) {
    resetErp(); resetAudit(); configureAuditFile(null);
    try { await test.run(); passed++; }
    catch (error) { failures.push({ name: test.name, error: error instanceof Error ? error.message : String(error) }); }
  }
  const total = cases.length;
  return { total, passed, failed: total - passed, passRate: Number((passed / total).toFixed(4)), durationMs: Date.now() - started, failures };
}
