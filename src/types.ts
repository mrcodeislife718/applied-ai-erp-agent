import type { Role } from './auth.js';

export type Domain = 'orders' | 'inventory' | 'purchasing' | 'manufacturing' | 'financials' | 'unknown';
export type Authority = 'read' | 'propose' | 'execute';
export type TraceEvent = { stage: string; detail: unknown };
export type UiComponent =
  | { type: 'OrderSummary'; props: Record<string, unknown> }
  | { type: 'InventoryAlert'; props: Record<string, unknown> }
  | { type: 'ProductionStatus'; props: Record<string, unknown> }
  | { type: 'FinancialApproval'; props: Record<string, unknown> }
  | { type: 'ActionProposal'; props: Record<string, unknown> }
  | { type: 'ApprovalRequest'; props: Record<string, unknown> }
  | { type: 'ExecutionReceipt'; props: Record<string, unknown> }
  | { type: 'SystemNotice'; props: Record<string, unknown> };

export type AgentResult = {
  requestId: string;
  actor: { id: string; role: Role };
  answer: string;
  domain: Domain;
  grounded: boolean;
  degraded: boolean;
  components: UiComponent[];
  trace: TraceEvent[];
};
