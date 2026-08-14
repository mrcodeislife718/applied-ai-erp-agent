import { randomUUID } from 'node:crypto';
import { appendAudit } from './audit.js';
import type { Principal } from './auth.js';
import { getValidatedDecision, type ModelProvider } from './provider.js';
import { FaultInjector, invokeWithReliability, ToolFailure } from './reliability.js';
import { routeIntent } from './router.js';
import { scopedTools, tools } from './tools.js';
import type { AgentResult, Domain, TraceEvent, UiComponent } from './types.js';

export type RunOptions = { approved?: boolean; faults?: FaultInjector; domainOverride?: Domain; principal?: Principal };
const defaultPrincipal: Principal = { id: 'demo-operator', role: 'operator' };

function finalize(requestId: string, actor: Principal, result: Omit<AgentResult, 'requestId' | 'actor'>): AgentResult {
  appendAudit(requestId, 'final', { grounded: result.grounded, degraded: result.degraded, domain: result.domain, actor });
  return { requestId, actor, ...result };
}

export function runAgent(input: string, opts: RunOptions = {}): AgentResult {
  const requestId = randomUUID();
  const actor = opts.principal ?? defaultPrincipal;
  const trace: TraceEvent[] = [];
  const record = (stage: string, detail: unknown) => {
    trace.push({ stage, detail });
    appendAudit(requestId, stage, detail);
  };
  const finish = (result: Omit<AgentResult, 'requestId' | 'actor'>) => finalize(requestId, actor, result);
  const domain = opts.domainOverride ?? routeIntent(input);
  record('identity', actor);
  record('intent', { input, domain });
  record('capability_scope', scopedTools(domain));

  const call = <T>(name: string, fn: () => T): T => invokeWithReliability(name, fn, {
    faults: opts.faults,
    onAttempt: (attempt, outcome) => record('tool_attempt', { name, attempt, outcome })
  });

  try {
    if (domain === 'manufacturing') {
      const productionId = input.match(/MO-\d+/i)?.[0].toUpperCase();
      if (!productionId) {
        record('grounding', { grounded: false, reason: 'missing_production_reference' });
        return finish({ answer: 'I need a manufacturing order ID such as MO-92 before I can inspect production state.', domain, grounded: false, degraded: false, components: [], trace });
      }
      const production = call('getProductionOrder', () => tools.getProductionOrder({ productionId }));
      record('tool', { name: 'getProductionOrder', result: production });
      if (!production) return finish({ answer: `I could not find ${productionId}. I will not invent production data.`, domain, grounded: false, degraded: false, components: [], trace });
      const supply = call('getSupplyOptions', () => tools.getSupplyOptions({ sku: production.sku }));
      record('tool', { name: 'getSupplyOptions', result: supply });
      const components: UiComponent[] = [{ type: 'ProductionStatus', props: { ...production, relatedSupply: { purchaseOrders: supply.purchaseOrders.length, inventoryLocations: supply.inventory.length } } }];
      return finish({ answer: `${productionId} is ${production.status} for ${production.quantity} ${production.sku} units at ${production.workCenter}, with completion planned for ${production.completionDate}.`, domain, grounded: true, degraded: false, components, trace });
    }

    if (domain === 'financials') {
      const invoiceId = input.match(/INV-\d+/i)?.[0].toUpperCase();
      if (!invoiceId) {
        record('grounding', { grounded: false, reason: 'missing_invoice_reference' });
        return finish({ answer: 'I need an invoice ID such as INV-300 before I can inspect or approve a financial record.', domain, grounded: false, degraded: false, components: [], trace });
      }
      const invoice = call('getInvoice', () => tools.getInvoice({ invoiceId }));
      record('tool', { name: 'getInvoice', result: invoice });
      if (!invoice) return finish({ answer: `I could not find ${invoiceId}. I will not invent financial data.`, domain, grounded: false, degraded: false, components: [], trace });
      const components: UiComponent[] = [{ type: 'FinancialApproval', props: invoice }];
      if (!opts.approved) {
        record('authority', { action: 'invoice.approve', allowed: false, reason: 'explicit_approval_required', actor });
        components.push({ type: 'ApprovalRequest', props: { action: 'invoice_approval', invoiceId, amount: invoice.amount, currency: invoice.currency, requiredRole: 'finance-approver' } });
        return finish({ answer: `${invoiceId} is ${invoice.status} for ${invoice.currency} ${invoice.amount}. Approval is a consequential financial action and requires explicit approval from a finance approver.`, domain, grounded: true, degraded: false, components, trace });
      }
      const execution = call('approveInvoice', () => tools.approveInvoice({ invoiceId, approved: true, idempotencyKey: `${requestId}:invoice`, expectedVersion: invoice.version }, actor));
      record('execution', execution);
      if (!execution.ok) {
        record('authority', { action: 'invoice.approve', allowed: false, reason: execution.reason, actor });
        components.push({ type: 'SystemNotice', props: { severity: 'warning', reason: execution.reason, writesBlocked: true } });
        return finish({ answer: `I did not approve ${invoiceId}: ${execution.reason}. No financial state was changed.`, domain, grounded: true, degraded: false, components, trace });
      }
      const verified = execution.replayed || ('stateChange' in execution && execution.stateChange.after.status === 'approved');
      record('verification', { verified, action: execution.action, replayed: execution.replayed });
      components.push({ type: 'ExecutionReceipt', props: { ...execution, verified } });
      return finish({ answer: `${invoiceId} was approved by ${actor.id} and the resulting ERP state was verified.`, domain, grounded: true, degraded: false, components, trace });
    }

    if (domain === 'unknown') {
      record('grounding', { grounded: false, reason: 'unknown_intent' });
      return finish({ answer: 'I could not map that request to an allowed ERP workflow. Try an order/inventory, manufacturing, purchasing, or financial request.', domain, grounded: false, degraded: false, components: [], trace });
    }

    const orderMatch = input.match(/SO-\d+/i);
    if (!orderMatch) {
      record('grounding', { grounded: false, reason: 'missing_order_reference' });
      return finish({ answer: 'I need a sales order ID such as SO-1842 before I can inspect the shortage safely.', domain, grounded: false, degraded: false, components: [], trace });
    }

    const orderId = orderMatch[0].toUpperCase();
    const order = call('getOrder', () => tools.getOrder({ orderId }));
    record('tool', { name: 'getOrder', args: { orderId }, result: order });
    if (!order) {
      record('grounding', { grounded: false, reason: 'order_not_found' });
      return finish({ answer: `I could not find ${orderId}. I will not invent order data.`, domain, grounded: false, degraded: false, components: [], trace });
    }

    const inventory = call('getInventory', () => tools.getInventory({ sku: order.sku }));
    const supply = call('getSupplyOptions', () => tools.getSupplyOptions({ sku: order.sku }));
    record('tool', { name: 'getInventory', result: inventory });
    record('tool', { name: 'getSupplyOptions', result: supply });
    const primary = inventory.find(r => r.warehouse === order.warehouse);
    if (!primary) {
      record('grounding', { grounded: false, reason: 'primary_inventory_not_found', warehouse: order.warehouse, sku: order.sku });
      return finish({ answer: `I found ${orderId}, but I cannot find inventory state for ${order.sku} at ${order.warehouse}. I will not recommend an action without that state.`, domain, grounded: false, degraded: false, components: [], trace });
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
          const execution = call('executeTransfer', () => tools.executeTransfer({
            sku: order.sku, quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse, approved: true,
            idempotencyKey: `${requestId}:transfer`, expectedSourceVersion: proposal.sourceVersion, expectedDestinationVersion: proposal.destinationVersion
          }, actor));
          record('execution', execution);
          if (!execution.ok) {
            record('authority', { action: 'inventory.transfer.execute', allowed: false, reason: execution.reason, actor });
            components.push({ type: 'SystemNotice', props: { severity: 'warning', reason: execution.reason, writesBlocked: true } });
          } else {
            const deltaVerified = execution.replayed || ('stateChange' in execution
              && execution.stateChange.before.sourceOnHand - execution.stateChange.after.sourceOnHand === suggestedTransfer
              && execution.stateChange.after.destinationOnHand - execution.stateChange.before.destinationOnHand === suggestedTransfer);
            const recordVerified = execution.transfer.status === 'created';
            const verified = Boolean(deltaVerified && recordVerified);
            record('verification', { verified, recordVerified, deltaVerified, transfer: execution.transfer, replayed: execution.replayed });
            components.push({ type: 'ExecutionReceipt', props: { ...execution, verified } });
          }
        } else {
          record('authority', { action: 'inventory.transfer.execute', allowed: false, reason: 'explicit_approval_required', actor });
          components.push({ type: 'ApprovalRequest', props: { action: 'warehouse_transfer', quantity: suggestedTransfer, from: alternate.warehouse, to: order.warehouse, requiredRole: 'operator' } });
        }
      }
    }

    const remaining = Math.max(0, shortage - suggestedTransfer);
    const answer = shortage === 0
      ? `${orderId} is currently covered from ${order.warehouse}.`
      : `${orderId} is short ${shortage} ${order.sku} units at ${order.warehouse}. ${availableAlternate} unallocated units exist at ${alternate?.warehouse ?? 'no alternate warehouse'}, with ${poIncoming} on confirmed purchase orders and ${productionIncoming} scheduled in production. ${suggestedTransfer > 0 ? `A transfer of ${suggestedTransfer} units can reduce the gap` : 'No warehouse transfer is currently available'}${remaining > 0 ? `; ${remaining} units would still need incoming supply or another intervention.` : '.'}`;
    return finish({ answer, domain, grounded: true, degraded: false, components, trace });
  } catch (error) {
    const reason = error instanceof ToolFailure ? error.code : 'unexpected_tool_failure';
    record('degraded', { reason, failClosed: true });
    return finish({
      answer: `I cannot safely complete this ERP request because a required tool failed (${reason}). I have not invented replacement data or executed an unverified write.`,
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
    const actor = opts.principal ?? defaultPrincipal;
    const trace: TraceEvent[] = [{ stage: 'model_validation', detail: { valid: false, failClosed: true } }];
    appendAudit(requestId, 'model_validation', trace[0].detail);
    return finalize(requestId, actor, {
      answer: 'The model produced an invalid structured decision, so the request was stopped before any ERP tool or write was executed.',
      domain: 'unknown', grounded: false, degraded: true,
      components: [{ type: 'SystemNotice', props: { severity: 'warning', reason: 'invalid_model_decision', writesBlocked: true } }], trace
    });
  }
}
