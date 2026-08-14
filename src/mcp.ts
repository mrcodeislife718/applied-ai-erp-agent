import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { tools } from './tools.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function createMcpServer() {
  const server = new McpServer({ name: 'applied-ai-erp-agent', version: '0.1.0' });

  server.registerTool('get-order', {
    description: 'Read one grounded sales order by ID.',
    inputSchema: z.object({ orderId: z.string().regex(/^SO-\d+$/) })
  }, async ({ orderId }) => text(tools.getOrder({ orderId })));

  server.registerTool('get-inventory', {
    description: 'Read inventory for a SKU, optionally scoped to a warehouse.',
    inputSchema: z.object({ sku: z.string(), warehouse: z.string().optional() })
  }, async ({ sku, warehouse }) => text(tools.getInventory({ sku, warehouse })));

  server.registerTool('get-supply-options', {
    description: 'Read grounded purchase-order, production, and inventory supply options for a SKU.',
    inputSchema: z.object({ sku: z.string() })
  }, async ({ sku }) => text(tools.getSupplyOptions({ sku })));

  server.registerTool('propose-transfer', {
    description: 'Propose a warehouse transfer. This never mutates ERP state and always requires approval before execution.',
    inputSchema: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string() })
  }, async (args) => text(tools.proposeTransfer(args)));

  server.registerTool('execute-transfer', {
    description: 'Execute an approved warehouse transfer and return the created ERP transfer record.',
    inputSchema: z.object({ sku: z.string(), quantity: z.number().int().positive(), from: z.string(), to: z.string(), approved: z.boolean() })
  }, async (args) => text(tools.executeTransfer(args)));

  return server;
}

serveStdio(createMcpServer);
