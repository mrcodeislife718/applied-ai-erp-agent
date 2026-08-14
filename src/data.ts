export type InventoryRecord = {
  warehouse: string;
  sku: string;
  onHand: number;
  allocated: number;
  version: number;
};

const initialInventory: Record<string, InventoryRecord> = {
  'NYC-1:AX-440': { warehouse: 'NYC-1', sku: 'AX-440', onHand: 700, allocated: 700, version: 1 },
  'NJ-2:AX-440': { warehouse: 'NJ-2', sku: 'AX-440', onHand: 220, allocated: 0, version: 1 }
};

const initialInvoices = {
  'INV-300': { id: 'INV-300', customer: 'Northstar Fabrication', amount: 18450, currency: 'USD', status: 'pending', version: 1 }
};

export const erp = {
  orders: {
    'SO-1842': { id: 'SO-1842', customer: 'Northstar Fabrication', sku: 'AX-440', quantity: 1000, dueDate: '2026-08-18', warehouse: 'NYC-1', status: 'open' }
  },
  inventory: structuredClone(initialInventory),
  purchaseOrders: {
    'PO-771': { id: 'PO-771', sku: 'AX-440', quantity: 120, supplier: 'Meridian Components', eta: '2026-08-17', status: 'confirmed' }
  },
  production: {
    'MO-92': { id: 'MO-92', sku: 'AX-440', quantity: 80, completionDate: '2026-08-17', status: 'scheduled', workCenter: 'CELL-A' }
  },
  invoices: structuredClone(initialInvoices),
  transfers: [] as Array<{ id: string; sku: string; quantity: number; from: string; to: string; status: string; actorId: string; idempotencyKey: string }>,
  financialActions: [] as Array<{ id: string; invoiceId: string; action: 'approve'; actorId: string; idempotencyKey: string }>
};

export function resetErp() {
  erp.inventory = structuredClone(initialInventory);
  erp.invoices = structuredClone(initialInvoices);
  erp.transfers.length = 0;
  erp.financialActions.length = 0;
}
