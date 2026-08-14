import assert from 'node:assert/strict';
import { auditFor, resetAudit } from './audit.js';
import { runAgent, runAgentWithProvider } from './agent.js';
import { resetErp, erp } from './data.js';
import { DeterministicProvider } from './provider.js';
import { FaultInjector } from './reliability.js';
import { routeIntent } from './router.js';
import { tools } from './tools.js';

const syncCases: Array<() => void> = [
  () => assert.equal(routeIntent('SO-1842 is short inventory'), 'inventory'),
  () => assert.equal(runAgent('Check shortage on SO-9999').grounded, false),
  () => assert.match(runAgent('Check shortage on SO-9999').answer, /will not invent/i),
  () => assert.equal(runAgent('We may be short on this order').grounded, false),
  () => {
    resetErp();
    const result = runAgent('We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.');
    assert.equal(result.grounded, true);
    assert.equal(result.degraded, false);
    assert.ok(result.components.some(c => c.type === 'ApprovalRequest'));
    assert.equal(result.trace.some(t => t.stage === 'execution'), false);
  },
  () => {
    resetErp();
    const beforeSource = erp.inventory['NJ-2:AX-440'].onHand;
    const beforeDest = erp.inventory['NYC-1:AX-440'].onHand;
    const result = runAgent('SO-1842 inventory shortage', { approved: true });
    assert.ok(result.components.some(c => c.type === 'ExecutionReceipt'));
    assert.equal(erp.inventory['NJ-2:AX-440'].onHand, beforeSource - 220);
    assert.equal(erp.inventory['NYC-1:AX-440'].onHand, beforeDest + 220);
    assert.ok(result.trace.some(t => t.stage === 'verification' && (t.detail as { verified?: boolean }).verified === true));
  },
  () => {
    resetErp();
    const direct = tools.executeTransfer({ sku: 'AX-440', quantity: 1, from: 'NJ-2', to: 'NYC-1', approved: false });
    assert.deepEqual(direct, { ok: false, reason: 'approval_required' });
  },
  () => {
    resetErp();
    const direct = tools.executeTransfer({ sku: 'AX-440', quantity: 999, from: 'NJ-2', to: 'NYC-1', approved: true });
    assert.deepEqual(direct, { ok: false, reason: 'insufficient_unallocated_inventory' });
  },
  () => {
    const result = runAgent('SO-1842 inventory shortage');
    const scoped = result.trace.find(t => t.stage === 'capability_scope');
    assert.ok(scoped && Array.isArray(scoped.detail));
    assert.equal((scoped.detail as string[]).includes('getSupplyOptions'), true);
  },
  () => {
    resetErp();
    const result = runAgent('SO-1842 inventory shortage', { faults: new FaultInjector({ getInventory: ['timeout', 'none'] }) });
    const attempts = result.trace.filter(t => t.stage === 'tool_attempt' && (t.detail as { name?: string }).name === 'getInventory');
    assert.equal(result.grounded, true);
    assert.equal(attempts.length, 2);
  },
  () => {
    resetErp();
    const result = runAgent('SO-1842 inventory shortage', { approved: true, faults: new FaultInjector({ getSupplyOptions: ['unavailable', 'unavailable'] }) });
    assert.equal(result.degraded, true);
    assert.equal(erp.transfers.length, 0);
    assert.ok(result.components.some(c => c.type === 'SystemNotice'));
  },
  () => {
    resetErp();
    const result = runAgent('SO-1842 inventory shortage', { approved: true, faults: new FaultInjector({ executeTransfer: ['timeout', 'timeout'] }) });
    assert.equal(result.degraded, true);
    assert.equal(erp.transfers.length, 0);
  },
  () => {
    resetAudit();
    const result = runAgent('SO-1842 inventory shortage');
    const records = auditFor(result.requestId);
    assert.ok(records.some(r => r.stage === 'intent'));
    assert.ok(records.some(r => r.stage === 'final'));
  }
];

let passed = 0;
for (const test of syncCases) {
  try { test(); passed++; }
  catch (error) { console.error(error); process.exitCode = 1; }
}

const asyncCases: Array<() => Promise<void>> = [
  async () => {
    const result = await runAgentWithProvider('SO-1842 inventory shortage', new DeterministicProvider('inventory'));
    assert.equal(result.grounded, true);
  },
  async () => {
    resetErp();
    const result = await runAgentWithProvider('SO-1842 inventory shortage', new DeterministicProvider('inventory', true), { approved: true });
    assert.equal(result.degraded, true);
    assert.equal(result.domain, 'unknown');
    assert.equal(erp.transfers.length, 0);
    assert.ok(result.trace.some(t => t.stage === 'model_validation'));
  }
];

for (const test of asyncCases) {
  try { await test(); passed++; }
  catch (error) { console.error(error); process.exitCode = 1; }
}

const total = syncCases.length + asyncCases.length;
console.log(`evals: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);
