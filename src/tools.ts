import { z } from 'zod';
import { erp } from './data.js';

export const ToolSchemas = {
  getOrder: z.object({ orderId: z.string().regex(/^SO-\d+$/) }),
  getInventory: z.object({ sku: z.string(), warehouse: z.string().optional() }),
  getSupplyOptions: z.object({ sku: z.string() }),
  proposeTransfer: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string() }),
  executeTransfer: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string(), approved: z.boolean() })
};

export const tools = {
  getOrder(args: z.infer<typeof ToolSchemas.getOrder>) {
    return erp.orders[args.orderId as keyof typeof erp.orders] ?? null;
  },
  getInventory(args: z.infer<typeof ToolSchemas.getInventory>) {
    return Object.values(erp.inventory).filter(r => r.sku === args.sku && (!args.warehouse || r.warehouse === args.warehouse));
  },
  getSupplyOptions(args: z.infer<typeof ToolSchemas.getSupplyOptions>) {
    return {
      purchaseOrders: Object.values(erp.purchaseOrders).filter(r => r.sku === args.sku),
      production: Object.values(erp.production).filter(r => r.sku === args.sku),
      inventory: Object.values(erp.inventory).filter(r => r.sku === args.sku)
    };
  },
  proposeTransfer(args: z.infer<typeof ToolSchemas.proposeTransfer>) {
    const source = erp.inventory[`${args.from}:${args.sku}` as keyof typeof erp.inventory];
    if (!source || source.onHand - source.allocated < args.quantity) return { ok: false, reason: 'insufficient_unallocated_inventory' };
    return { ok: true, proposal: args, requiresApproval: true };
  },
  executeTransfer(args: z.infer<typeof ToolSchemas.executeTransfer>) {
    if (!args.approved) return { ok: false, reason: 'approval_required' };
    const source = erp.inventory[`${args.from}:${args.sku}` as keyof typeof erp.inventory];
    if (!source || source.onHand - source.allocated < args.quantity) return { ok: false, reason: 'insufficient_unallocated_inventory' };
    const transfer = { id: `TR-${erp.transfers.length + 1}`, sku: args.sku, quantity: args.quantity, from: args.from, to: args.to, status: 'created' };
    erp.transfers.push(transfer);
    return { ok: true, transfer };
  }
};

export type ToolName = keyof typeof tools;
export function scopedTools(domain: string): ToolName[] {
  if (domain === 'inventory' || domain === 'orders') return ['getOrder', 'getInventory', 'getSupplyOptions', 'proposeTransfer', 'executeTransfer'];
  if (domain === 'purchasing') return ['getSupplyOptions'];
  return [];
}
