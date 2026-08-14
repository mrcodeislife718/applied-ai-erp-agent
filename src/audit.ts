import { randomUUID } from 'node:crypto';

export type AuditRecord = {
  id: string;
  timestamp: string;
  requestId: string;
  stage: string;
  detail: unknown;
};

const records: AuditRecord[] = [];

export function appendAudit(requestId: string, stage: string, detail: unknown): AuditRecord {
  const record = { id: randomUUID(), timestamp: new Date().toISOString(), requestId, stage, detail };
  records.push(record);
  return record;
}

export function auditFor(requestId: string): AuditRecord[] {
  return records.filter(record => record.requestId === requestId);
}

export function resetAudit() {
  records.length = 0;
}
