import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { currentPrincipal } from './auth.js';
import { tools } from './tools.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function createMcpServer() {
  const server = new McpServer({ name: 'applied-ai-erp-agent', version: '1.0.0' });

  server.registerTool('get-order', { description: 'Read one grounded sales order by ID.', inputSchema: z.object({ orderId: z.string().regex(/^SO-\d+$/) }) },
    async ({ orderId }) => text(tools.getOrder({ orderId })));
  server.registerTool('get-inventory', { description: 'Read inventory for a SKU, optionally scoped to a warehouse.', inputSchema: z.object({ sku: z.string(), warehouse: z.string().optional() }) },
    async ({ sku, warehouse }) => text(tools.getInventory({ sku, warehouse })));
  server.registerTool('get-supply-options', { description: 'Read confirmed purchasing, production, and inventory supply options.', inputSchema: z.object({ sku: z.string() }) },
    async ({ sku }) => text(tools.getSupplyOptions({ sku })));
  server.registerTool('get-production-order', { description: 'Read one grounded manufacturing order.', inputSchema: z.object({ productionId: z.string().regex(/^MO-\d+$/) }) },
    async ({ productionId }) => text(tools.getProductionOrder({ productionId })));
  server.registerTool('get-invoice', { description: 'Read one grounded invoice.', inputSchema: z.object({ invoiceId: z.string().regex(/^INV-\d+$/) }) },
    async ({ invoiceId }) => text(tools.getInvoice({ invoiceId })));
  server.registerTool('propose-transfer', {
    description: 'Validate a warehouse transfer proposal without mutating ERP state.',
    inputSchema: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string() })
  }, async (args) => text(tools.proposeTransfer(args)));
  server.registerTool('execute-transfer', {
    description: 'Execute an approved, authorized and idempotent warehouse transfer with optimistic concurrency checks.',
    inputSchema: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string(), approved: z.boolean(), idempotencyKey: z.string().min(8), expectedSourceVersion: z.number().int().positive().optional(), expectedDestinationVersion: z.number().int().positive().optional() })
  }, async (args) => text(tools.executeTransfer(args, currentPrincipal())));
  server.registerTool('approve-invoice', {
    description: 'Approve a financial invoice only for an authenticated finance-approver, with idempotency and version checks.',
    inputSchema: z.object({ invoiceId: z.string().regex(/^INV-\d+$/), approved: z.boolean(), idempotencyKey: z.string().min(8), expectedVersion: z.number().int().positive().optional() })
  }, async (args) => text(tools.approveInvoice(args, currentPrincipal())));

  return server;
}
