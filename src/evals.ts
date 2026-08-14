import assert from 'node:assert/strict';
import { runAgent } from './agent.js';
import { erp, resetErp } from './data.js';
import { routeIntent } from './router.js';
import { tools } from './tools.js';

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'routes shortage intent to inventory',
    run: () => assert.equal(routeIntent('SO-1842 is short inventory'), 'inventory')
  },
  {
    name: 'refuses nonexistent order grounding',
    run: () => {
      assert.equal(runAgent('Check shortage on SO-9999').grounded, false);
      assert.match(runAgent('Check shortage on SO-9999').answer, /will not invent/i);
    }
  },
  {
    name: 'requires an order identifier',
    run: () => assert.equal(runAgent('We may be short on this order').grounded, false)
  },
  {
    name: 'proposes but does not execute without approval',
    run: () => {
      resetErp();
      const result = runAgent('We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.');
      assert.equal(result.grounded, true);
      assert.ok(result.components.some(c => c.type === 'ApprovalRequest'));
      assert.equal(result.trace.some(t => t.stage === 'execution'), false);
      assert.equal(erp.transfers.length, 0);
    }
  },
  {
    name: 'direct write tool rejects missing approval',
    run: () => {
      resetErp();
      const result = tools.executeTransfer({ sku: 'AX-440', quantity: 100, from: 'NJ-2', to: 'NYC-1', approved: false });
      assert.deepEqual(result, { ok: false, reason: 'approval_required' });
      assert.equal(erp.transfers.length, 0);
    }
  },
  {
    name: 'approved action mutates state and is independently verified',
    run: () => {
      resetErp();
      const beforeSource = erp.inventory['NJ-2:AX-440'].onHand;
      const beforeDestination = erp.inventory['NYC-1:AX-440'].onHand;
      const result = runAgent('SO-1842 inventory shortage', { approved: true });
      assert.ok(result.components.some(c => c.type === 'ExecutionReceipt'));
      const verification = result.trace.find(t => t.stage === 'verification');
      assert.ok(verification);
      assert.equal((verification.detail as { verified: boolean }).verified, true);
      assert.equal(erp.inventory['NJ-2:AX-440'].onHand, beforeSource - 220);
      assert.equal(erp.inventory['NYC-1:AX-440'].onHand, beforeDestination + 220);
      assert.equal(erp.transfers.length, 1);
    }
  },
  {
    name: 'rejects transfer larger than available unallocated inventory',
    run: () => {
      resetErp();
      const proposal = tools.proposeTransfer({ sku: 'AX-440', quantity: 221, from: 'NJ-2', to: 'NYC-1' });
      assert.deepEqual(proposal, { ok: false, reason: 'insufficient_unallocated_inventory' });
    }
  },
  {
    name: 'capability scope exposes only relevant tools',
    run: () => {
      resetErp();
      const result = runAgent('SO-1842 inventory shortage');
      const scoped = result.trace.find(t => t.stage === 'capability_scope');
      assert.ok(scoped);
      assert.ok(Array.isArray(scoped.detail));
      assert.equal((scoped.detail as string[]).includes('getSupplyOptions'), true);
    }
  }
];

let passed = 0;
for (const test of cases) {
  try {
    test.run();
    passed++;
    console.log(`PASS ${test.name}`);
  } catch (error) {
    console.error(`FAIL ${test.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`evals: ${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exit(1);
