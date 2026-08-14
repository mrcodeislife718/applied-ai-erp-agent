import { z } from 'zod';
import { erp } from './data.js';

export const ToolSchemas = {
  getOrder: z.object({ orderId: z.string().regex(/^SO-\d+$/) }),
  getInventory: z.object({ sku: z.string(), warehouse: z.string().optional() }),
  getSupplyOptions: z.object({ sku: z.string() }),
  proposeTransfer: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string() }).refine(v => v.from !== v.to, 'source and destination must differ'),
  executeTransfer: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string(), approved: z.boolean() }).refine(v => v.from !== v.to, 'source and destination must differ')
};

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

  proposeTransfer(args: z.infer<typeof ToolSchemas.proposeTransfer>) {
    const parsed = ToolSchemas.proposeTransfer.parse(args);
    const source = erp.inventory[`${parsed.from}:${parsed.sku}`];
    const destination = erp.inventory[`${parsed.to}:${parsed.sku}`];
    if (!source) return { ok: false as const, reason: 'source_inventory_not_found' };
    if (!destination) return { ok: false as const, reason: 'destination_inventory_not_found' };
    if (source.onHand - source.allocated < parsed.quantity) return { ok: false as const, reason: 'insufficient_unallocated_inventory' };
    return { ok: true as const, proposal: parsed, requiresApproval: true as const };
  },

  executeTransfer(args: z.infer<typeof ToolSchemas.executeTransfer>) {
    const parsed = ToolSchemas.executeTransfer.parse(args);
    if (!parsed.approved) return { ok: false as const, reason: 'approval_required' };

    const sourceKey = `${parsed.from}:${parsed.sku}`;
    const destinationKey = `${parsed.to}:${parsed.sku}`;
    const source = erp.inventory[sourceKey];
    const destination = erp.inventory[destinationKey];

    if (!source) return { ok: false as const, reason: 'source_inventory_not_found' };
    if (!destination) return { ok: false as const, reason: 'destination_inventory_not_found' };
    if (source.onHand - source.allocated < parsed.quantity) return { ok: false as const, reason: 'insufficient_unallocated_inventory' };

    const before = {
      sourceOnHand: source.onHand,
      destinationOnHand: destination.onHand
    };

    source.onHand -= parsed.quantity;
    destination.onHand += parsed.quantity;

    const transfer = {
      id: `TR-${erp.transfers.length + 1}`,
      sku: parsed.sku,
      quantity: parsed.quantity,
      from: parsed.from,
      to: parsed.to,
      status: 'created'
    };
    erp.transfers.push(transfer);

    return {
      ok: true as const,
      transfer,
      stateChange: {
        before,
        after: {
          sourceOnHand: source.onHand,
          destinationOnHand: destination.onHand
        }
      }
    };
  }
};

export type ToolName = keyof typeof tools;

export function scopedTools(domain: string): ToolName[] {
  if (domain === 'inventory' || domain === 'orders') return ['getOrder', 'getInventory', 'getSupplyOptions', 'proposeTransfer', 'executeTransfer'];
  if (domain === 'purchasing') return ['getSupplyOptions'];
  return [];
}
