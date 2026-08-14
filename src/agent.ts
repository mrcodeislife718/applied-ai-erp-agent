import { randomUUID } from 'node:crypto';
import { appendAudit } from './audit.js';
import { getValidatedDecision, type ModelProvider } from './provider.js';
import { FaultInjector, invokeWithReliability, ToolFailure } from './reliability.js';
import { routeIntent } from './router.js';
import { scopedTools, tools } from './tools.js';
import type { AgentResult, Domain, TraceEvent, UiComponent } from './types.js';

export type RunOptions = { approved?: boolean; faults?: FaultInjector; domainOverride?: Domain };

function finalize(requestId: string, result: Omit<AgentResult, 'requestId'>): AgentResult {
  appendAudit(requestId, 'final', { grounded: result.grounded, degraded: result.degraded, domain: result.domain });
  return { requestId, ...result };
}

export function runAgent(input: string, opts: RunOptions = {}): AgentResult {
  const requestId = randomUUID();
  const trace: TraceEvent[] = [];
  const record = (stage: string, detail: unknown) => {
    trace.push({ stage, detail });
    appendAudit(requestId, stage, detail);
  };

  const domain = opts.domainOverride ?? routeIntent(input);
  record('intent', { input, domain });
  record('capability_scope', scopedTools(domain));

  const orderMatch = input.match(/SO-\d+/i);
  if (!orderMatch) {
    record('grounding', { grounded: false, reason: 'missing_order_reference' });
    return finalize(requestId, { answer: 'I need a sales order ID such as SO-1842 before I can inspect the shortage safely.', domain, grounded: false, degraded: false, components: [], trace });
  }

  const orderId = orderMatch[0].toUpperCase();
  try {
    const call = <T>(name: string, fn: () => T): T => invokeWithReliability(name, fn, {
      faults: opts.faults,
      onAttempt: (attempt, outcome) => record('tool_attempt', { name, attempt, outcome })
    });

    const order = call('getOrder', () => tools.getOrder({ orderId }));
    record('tool', { name: 'getOrder', args: { orderId }, result: order });
    if (!order) {
      record('grounding', { grounded: false, reason: 'order_not_found' });
      return finalize(requestId, { answer: `I could not find ${orderId}. I will not invent order data.`, domain, grounded: false, degraded: false, components: [], trace });
    }

    const inventory = call('getInventory', () => tools.getInventory({ sku: order.sku }));
    const supply = call('getSupplyOptions', () => tools.getSupplyOptions({ sku: order.sku }));
    record('tool', { name: 'getInventory', result: inventory });
    record('tool', { name: 'getSupplyOptions', result: supply });

    const primary = inventory.find(r => r.warehouse === order.warehouse);
    if (!primary) {
      record('grounding', { grounded: false, reason: 'primary_inventory_not_found', warehouse: order.warehouse, sku: order.sku });
      return finalize(requestId, { answer: `I found ${orderId}, but I cannot find inventory state for ${order.sku} at ${order.warehouse}. I will not recommend an action without that state.`, domain, grounded: false, degraded: false, components: [], trace });
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
      const proposal = call('proposeTransfer', () => tools.proposeTransfer({ sku: order.sku, quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse }));
      record('tool', { name: 'proposeTransfer', result: proposal });
      if (!proposal.ok) {
        suggestedTransfer = 0;
        record('safety', { action: 'warehouse_transfer', allowed: false, reason: proposal.reason });
      } else {
        components.push({ type: 'ActionProposal', props: { action: 'warehouse_transfer', quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse, requiresApproval: true } });
        if (opts.approved) {
          const execution = call('executeTransfer', () => tools.executeTransfer({ sku: order.sku, quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse, approved: true }));
          record('execution', execution);
          const deltaVerified = execution.ok
            && execution.stateChange.before.sourceOnHand - execution.stateChange.after.sourceOnHand === suggestedTransfer
            && execution.stateChange.after.destinationOnHand - execution.stateChange.before.destinationOnHand === suggestedTransfer;
          const recordVerified = Boolean(execution.ok && execution.transfer.status === 'created');
          const verified = Boolean(deltaVerified && recordVerified);
          record('verification', { verified, recordVerified, deltaVerified, transfer: execution.ok ? execution.transfer : null });
          components.push({ type: 'ExecutionReceipt', props: { ...execution, verified } });
        } else {
          record('authority', { action: 'executeTransfer', allowed: false, reason: 'approval_required' });
          components.push({ type: 'ApprovalRequest', props: { action: 'warehouse_transfer', quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse } });
        }
      }
    }

    const remaining = Math.max(0, shortage - suggestedTransfer);
    const answer = shortage === 0
      ? `${orderId} is currently covered from ${order.warehouse}.`
      : `${orderId} is short ${shortage} ${order.sku} units at ${order.warehouse}. ${availableAlternate} unallocated units exist at ${alternate?.warehouse ?? 'no alternate warehouse'}, with ${poIncoming} on confirmed purchase orders and ${productionIncoming} scheduled in production. ${suggestedTransfer > 0 ? `A transfer of ${suggestedTransfer} units can reduce the gap` : 'No warehouse transfer is currently available'}${remaining > 0 ? `; ${remaining} units would still need incoming supply or another intervention.` : '.'}`;
    return finalize(requestId, { answer, domain, grounded: true, degraded: false, components, trace });
  } catch (error) {
    const reason = error instanceof ToolFailure ? error.code : 'unexpected_tool_failure';
    record('degraded', { reason, failClosed: true });
    return finalize(requestId, {
      answer: `I cannot safely complete this ERP analysis because a required tool failed (${reason}). I have not invented replacement data or executed a write.`,
      domain, grounded: false, degraded: true,
      components: [{ type: 'SystemNotice', props: { severity: 'warning', reason, writesBlocked: true } }], trace
    });
  }
}

export async function runAgentWithProvider(input: string, provider: ModelProvider, opts: Omit<RunOptions, 'domainOverride'> = {}): Promise<AgentResult> {
  try {
    const decision = await getValidatedDecision(provider, input);
    return runAgent(input, { ...opts, domainOverride: decision.domain });
  } catch {
    const requestId = randomUUID();
    const trace: TraceEvent[] = [{ stage: 'model_validation', detail: { valid: false, failClosed: true } }];
    appendAudit(requestId, 'model_validation', trace[0].detail);
    return finalize(requestId, {
      answer: 'The model produced an invalid structured decision, so the request was stopped before any ERP tool or write was executed.',
      domain: 'unknown', grounded: false, degraded: true,
      components: [{ type: 'SystemNotice', props: { severity: 'warning', reason: 'invalid_model_decision', writesBlocked: true } }], trace
    });
  }
}
