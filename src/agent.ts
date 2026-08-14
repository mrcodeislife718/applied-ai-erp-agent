import { routeIntent } from './router.js';
import { scopedTools, tools } from './tools.js';
import type { AgentResult, TraceEvent, UiComponent } from './types.js';

export function runAgent(input: string, opts: { approved?: boolean } = {}): AgentResult {
  const trace: TraceEvent[] = [];
  const domain = routeIntent(input);
  trace.push({ stage: 'intent', detail: { input, domain } });

  const available = scopedTools(domain);
  trace.push({ stage: 'capability_scope', detail: available });

  const orderMatch = input.match(/SO-\d+/i);
  if (!orderMatch) {
    trace.push({ stage: 'grounding', detail: { grounded: false, reason: 'missing_order_reference' } });
    return { answer: 'I need a sales order ID such as SO-1842 before I can inspect the shortage safely.', domain, grounded: false, components: [], trace };
  }

  const orderId = orderMatch[0].toUpperCase();
  const order = tools.getOrder({ orderId });
  trace.push({ stage: 'tool', detail: { name: 'getOrder', args: { orderId }, result: order } });
  if (!order) {
    trace.push({ stage: 'grounding', detail: { grounded: false, reason: 'order_not_found' } });
    return { answer: `I could not find ${orderId}. I will not invent order data.`, domain, grounded: false, components: [], trace };
  }

  const inventory = tools.getInventory({ sku: order.sku });
  const supply = tools.getSupplyOptions({ sku: order.sku });
  trace.push({ stage: 'tool', detail: { name: 'getInventory', result: inventory } });
  trace.push({ stage: 'tool', detail: { name: 'getSupplyOptions', result: supply } });

  const primary = inventory.find(r => r.warehouse === order.warehouse);
  if (!primary) {
    trace.push({ stage: 'grounding', detail: { grounded: false, reason: 'primary_inventory_not_found', warehouse: order.warehouse, sku: order.sku } });
    return { answer: `I found ${orderId}, but I cannot find inventory state for ${order.sku} at ${order.warehouse}. I will not recommend an action without that state.`, domain, grounded: false, components: [], trace };
  }

  const shortage = Math.max(0, order.quantity - primary.onHand);
  const alternate = inventory.find(r => r.warehouse !== order.warehouse && r.onHand - r.allocated > 0);
  const availableAlternate = alternate ? alternate.onHand - alternate.allocated : 0;
  const poIncoming = supply.purchaseOrders.reduce((sum, po) => sum + po.quantity, 0);
  const productionIncoming = supply.production.reduce((sum, mo) => sum + mo.quantity, 0);

  const components: UiComponent[] = [
    { type: 'OrderSummary', props: order },
    { type: 'InventoryAlert', props: { sku: order.sku, shortage, warehouse: order.warehouse } }
  ];

  let suggestedTransfer = Math.min(shortage, availableAlternate);
  if (suggestedTransfer > 0 && alternate) {
    const proposal = tools.proposeTransfer({ sku: order.sku, quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse });
    trace.push({ stage: 'tool', detail: { name: 'proposeTransfer', result: proposal } });

    if (!proposal.ok) {
      suggestedTransfer = 0;
      trace.push({ stage: 'safety', detail: { action: 'warehouse_transfer', allowed: false, reason: proposal.reason } });
    } else {
      components.push({ type: 'ActionProposal', props: { action: 'warehouse_transfer', quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse, requiresApproval: true } });

      if (opts.approved) {
        const execution = tools.executeTransfer({ sku: order.sku, quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse, approved: true });
        trace.push({ stage: 'execution', detail: execution });

        const deltaVerified = execution.ok
          && execution.stateChange.before.sourceOnHand - execution.stateChange.after.sourceOnHand === suggestedTransfer
          && execution.stateChange.after.destinationOnHand - execution.stateChange.before.destinationOnHand === suggestedTransfer;
        const recordVerified = Boolean(execution.ok && execution.transfer.status === 'created');
        const verified = Boolean(deltaVerified && recordVerified);

        trace.push({ stage: 'verification', detail: { verified, recordVerified, deltaVerified, transfer: execution.ok ? execution.transfer : null } });
        components.push({ type: 'ExecutionReceipt', props: { ...execution, verified } });
      } else {
        trace.push({ stage: 'authority', detail: { action: 'executeTransfer', allowed: false, reason: 'approval_required' } });
        components.push({ type: 'ApprovalRequest', props: { action: 'warehouse_transfer', quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse } });
      }
    }
  }

  const remaining = Math.max(0, shortage - suggestedTransfer);
  const answer = shortage === 0
    ? `${orderId} is currently covered from ${order.warehouse}.`
    : `${orderId} is short ${shortage} ${order.sku} units at ${order.warehouse}. ${availableAlternate} unallocated units exist at ${alternate?.warehouse ?? 'no alternate warehouse'}, with ${poIncoming} on confirmed purchase orders and ${productionIncoming} scheduled in production. ${suggestedTransfer > 0 ? `A transfer of ${suggestedTransfer} units can reduce the gap` : 'No warehouse transfer is currently available'}${remaining > 0 ? `; ${remaining} units would still need incoming supply or another intervention.` : '.'}`;

  return { answer, domain, grounded: true, components, trace };
}
