import assert from 'node:assert/strict';
import { runAgent } from './agent.js';
import { resetErp } from './data.js';
import { routeIntent } from './router.js';

const cases = [
  () => assert.equal(routeIntent('SO-1842 is short inventory'), 'inventory'),
  () => assert.equal(runAgent('Check shortage on SO-9999').grounded, false),
  () => assert.match(runAgent('Check shortage on SO-9999').answer, /will not invent/i),
  () => assert.equal(runAgent('We may be short on this order').grounded, false),
  () => {
    resetErp();
    const result = runAgent('We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.');
    assert.equal(result.grounded, true);
    assert.ok(result.components.some(c => c.type === 'ApprovalRequest'));
    assert.equal(result.trace.some(t => t.stage === 'execution'), false);
  },
  () => {
    resetErp();
    const result = runAgent('SO-1842 inventory shortage', { approved: true });
    assert.ok(result.components.some(c => c.type === 'ExecutionReceipt'));
    assert.ok(result.trace.some(t => t.stage === 'verification'));
  },
  () => {
    const result = runAgent('SO-1842 inventory shortage');
    const scoped = result.trace.find(t => t.stage === 'capability_scope');
    assert.ok(scoped);
    assert.ok(Array.isArray(scoped.detail));
    assert.equal((scoped.detail as string[]).includes('getSupplyOptions'), true);
  }
];

let passed = 0;
for (const test of cases) {
  try { test(); passed++; }
  catch (error) { console.error(error); process.exitCode = 1; }
}
console.log(`evals: ${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exit(1);
