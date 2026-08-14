import { z } from 'zod';
import { authorize, type Principal } from './auth.js';
import { erp } from './data.js';

export const ToolSchemas = {
  getOrder: z.object({ orderId: z.string().regex(/^SO-\d+$/) }),
  getInventory: z.object({ sku: z.string(), warehouse: z.string().optional() }),
  getSupplyOptions: z.object({ sku: z.string() }),
  getProductionOrder: z.object({ productionId: z.string().regex(/^MO-\d+$/) }),
  getInvoice: z.object({ invoiceId: z.string().regex(/^INV-\d+$/) }),
  proposeTransfer: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string() }).refine(v => v.from !== v.to, 'source and destination must differ'),
  executeTransfer: z.object({
    sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string(), approved: z.boolean(),
    idempotencyKey: z.string().min(8), expectedSourceVersion: z.number().int().positive().optional(), expectedDestinationVersion: z.number().int().positive().optional()
  }).refine(v => v.from !== v.to, 'source and destination must differ'),
  approveInvoice: z.object({ invoiceId: z.string().regex(/^INV-\d+$/), approved: z.boolean(), idempotencyKey: z.string().min(8), expectedVersion: z.number().int().positive().optional() })
};

const anonymous: Principal = { id: 'direct-tool-call', role: 'viewer' };

export const tools = {
  getOrder(args: z.infer<typeof ToolSchemas.getOrder>) {
    const parsed = ToolSchemas.getOrder.parse(args);
    return erp.orders[parsed.orderId as keyof typeof erp.orders] ?? null;
  },

  getInventory(args: z.infer<typeof ToolSchemas.getInventory>) {
    const parsed = ToolSchemas.getInventory.parse(args);
    return Object.values(erp.inventory).filter(r => r.sku === parsed.sku && (!parsed.warehouse || r.warehouse === parsed.warehouse));
  },

  getSupplyOptions(args: z.infer<typeof ToolSchemas.getSupplyOptions>) {
    const parsed = ToolSchemas.getSupplyOptions.parse(args);
    return {
      purchaseOrders: Object.values(erp.purchaseOrders).filter(r => r.sku === parsed.sku && r.status === 'confirmed'),
      production: Object.values(erp.production).filter(r => r.sku === parsed.sku && r.status === 'scheduled'),
      inventory: Object.values(erp.inventory).filter(r => r.sku === parsed.sku)
    };
  },

  getProductionOrder(args: z.infer<typeof ToolSchemas.getProductionOrder>) {
    const parsed = ToolSchemas.getProductionOrder.parse(args);
    return erp.production[parsed.productionId as keyof typeof erp.production] ?? null;
  },

  getInvoice(args: z.infer<typeof ToolSchemas.getInvoice>) {
    const parsed = ToolSchemas.getInvoice.parse(args);
    return erp.invoices[parsed.invoiceId as keyof typeof erp.invoices] ?? null;
  },

  proposeTransfer(args: z.infer<typeof ToolSchemas.proposeTransfer>) {
    const parsed = ToolSchemas.proposeTransfer.parse(args);
    const source = erp.inventory[`${parsed.from}:${parsed.sku}`];
    const destination = erp.inventory[`${parsed.to}:${parsed.sku}`];
    if (!source) return { ok: false as const, reason: 'source_inventory_not_found' };
    if (!destination) return { ok: false as const, reason: 'destination_inventory_not_found' };
    if (source.onHand - source.allocated < parsed.quantity) return { ok: false as const, reason: 'insufficient_unallocated_inventory' };
    return { ok: true as const, proposal: parsed, requiresApproval: true as const, sourceVersion: source.version, destinationVersion: destination.version };
  },

  executeTransfer(args: z.infer<typeof ToolSchemas.executeTransfer>, principal: Principal = anonymous) {
    const parsed = ToolSchemas.executeTransfer.parse(args);
    if (!parsed.approved) return { ok: false as const, reason: 'approval_required' };
    const policy = authorize(principal, 'inventory.transfer.execute');
    if (!policy.allowed) return { ok: false as const, reason: policy.reason ?? 'policy_denied' };

    const prior = erp.transfers.find(t => t.idempotencyKey === parsed.idempotencyKey);
    if (prior) {
      const same = prior.sku === parsed.sku && prior.quantity === parsed.quantity && prior.from === parsed.from && prior.to === parsed.to;
      return same ? { ok: true as const, transfer: prior, replayed: true as const } : { ok: false as const, reason: 'idempotency_key_conflict' };
    }

    const source = erp.inventory[`${parsed.from}:${parsed.sku}`];
    const destination = erp.inventory[`${parsed.to}:${parsed.sku}`];
    if (!source) return { ok: false as const, reason: 'source_inventory_not_found' };
    if (!destination) return { ok: false as const, reason: 'destination_inventory_not_found' };
    if (parsed.expectedSourceVersion && source.version !== parsed.expectedSourceVersion) return { ok: false as const, reason: 'source_version_conflict' };
    if (parsed.expectedDestinationVersion && destination.version !== parsed.expectedDestinationVersion) return { ok: false as const, reason: 'destination_version_conflict' };
    if (source.onHand - source.allocated < parsed.quantity) return { ok: false as const, reason: 'insufficient_unallocated_inventory' };

    const before = { sourceOnHand: source.onHand, destinationOnHand: destination.onHand, sourceVersion: source.version, destinationVersion: destination.version };
    source.onHand -= parsed.quantity;
    destination.onHand += parsed.quantity;
    source.version += 1;
    destination.version += 1;

    const transfer = { id: `TR-${erp.transfers.length + 1}`, sku: parsed.sku, quantity: parsed.quantity, from: parsed.from, to: parsed.to, status: 'created', actorId: principal.id, idempotencyKey: parsed.idempotencyKey };
    erp.transfers.push(transfer);
    return { ok: true as const, transfer, replayed: false as const, stateChange: { before, after: { sourceOnHand: source.onHand, destinationOnHand: destination.onHand, sourceVersion: source.version, destinationVersion: destination.version } } };
  },

  approveInvoice(args: z.infer<typeof ToolSchemas.approveInvoice>, principal: Principal = anonymous) {
    const parsed = ToolSchemas.approveInvoice.parse(args);
    if (!parsed.approved) return { ok: false as const, reason: 'approval_required' };
    const policy = authorize(principal, 'invoice.approve');
    if (!policy.allowed) return { ok: false as const, reason: policy.reason ?? 'policy_denied' };
    const prior = erp.financialActions.find(a => a.idempotencyKey === parsed.idempotencyKey);
    if (prior) return prior.invoiceId === parsed.invoiceId ? { ok: true as const, action: prior, replayed: true as const } : { ok: false as const, reason: 'idempotency_key_conflict' };

    const invoice = erp.invoices[parsed.invoiceId as keyof typeof erp.invoices];
    if (!invoice) return { ok: false as const, reason: 'invoice_not_found' };
    if (parsed.expectedVersion && invoice.version !== parsed.expectedVersion) return { ok: false as const, reason: 'invoice_version_conflict' };
    if (invoice.status !== 'pending') return { ok: false as const, reason: 'invoice_not_pending' };
    const before = { status: invoice.status, version: invoice.version };
    invoice.status = 'approved';
    invoice.version += 1;
    const action = { id: `FA-${erp.financialActions.length + 1}`, invoiceId: parsed.invoiceId, action: 'approve' as const, actorId: principal.id, idempotencyKey: parsed.idempotencyKey };
    erp.financialActions.push(action);
    return { ok: true as const, action, replayed: false as const, stateChange: { before, after: { status: invoice.status, version: invoice.version } } };
  }
};

export type ToolName = keyof typeof tools;

export function scopedTools(domain: string): ToolName[] {
  if (domain === 'inventory' || domain === 'orders') return ['getOrder', 'getInventory', 'getSupplyOptions', 'proposeTransfer', 'executeTransfer'];
  if (domain === 'purchasing') return ['getSupplyOptions'];
  if (domain === 'manufacturing') return ['getProductionOrder', 'getSupplyOptions'];
  if (domain === 'financials') return ['getInvoice', 'approveInvoice'];
  return [];
}
