import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type AuditRecord = {
  id: string;
  timestamp: string;
  requestId: string;
  stage: string;
  detail: unknown;
  previousHash: string | null;
  hash: string;
};

const records: AuditRecord[] = [];
let auditFile: string | null = process.env.AUDIT_FILE ?? null;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().filter(k => object[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function configureAuditFile(path: string | null) {
  auditFile = path;
  if (auditFile) mkdirSync(dirname(auditFile), { recursive: true });
}

export function appendAudit(requestId: string, stage: string, detail: unknown): AuditRecord {
  const previousHash = records.at(-1)?.hash ?? null;
  const base = { id: randomUUID(), timestamp: new Date().toISOString(), requestId, stage, detail, previousHash };
  const record: AuditRecord = { ...base, hash: digest(base) };
  records.push(record);
  if (auditFile) appendFileSync(auditFile, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export function auditFor(requestId: string): AuditRecord[] {
  return records.filter(record => record.requestId === requestId);
}

export function auditStats() {
  return {
    records: records.length,
    requests: new Set(records.map(r => r.requestId)).size,
    degraded: records.filter(r => r.stage === 'degraded').length,
    verifiedWrites: records.filter(r => r.stage === 'verification' && Boolean((r.detail as { verified?: boolean })?.verified)).length
  };
}

export function verifyAuditChain(): boolean {
  let previousHash: string | null = null;
  for (const record of records) {
    const { hash, ...base } = record;
    if (record.previousHash !== previousHash || digest(base) !== hash) return false;
    previousHash = hash;
  }
  return true;
}

export function resetAudit() {
  records.length = 0;
  if (auditFile) writeFileSync(auditFile, '', 'utf8');
}
