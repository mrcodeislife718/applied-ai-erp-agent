import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type Role = 'viewer' | 'planner' | 'operator' | 'finance-approver';
export type Principal = { id: string; role: Role };

type SessionPayload = Principal & { exp: number };

const principalContext = new AsyncLocalStorage<Principal>();
const secret = process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');

function sign(body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function issueSession(principal: Principal, ttlSeconds = 900): string {
  const payload: SessionPayload = { ...principal, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySession(token: string): Principal | null {
  const [body, suppliedSignature] = token.split('.');
  if (!body || !suppliedSignature) return null;
  const expected = Buffer.from(sign(body));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!['viewer', 'planner', 'operator', 'finance-approver'].includes(payload.role)) return null;
    if (!payload.id || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: payload.id, role: payload.role };
  } catch {
    return null;
  }
}

export function principalFromAuthorization(header: string | undefined): Principal | null {
  if (!header?.startsWith('Bearer ')) return null;
  return verifySession(header.slice('Bearer '.length));
}

export function runAsPrincipal<T>(principal: Principal, fn: () => T): T {
  return principalContext.run(principal, fn);
}

export function currentPrincipal(): Principal {
  return principalContext.getStore() ?? { id: 'anonymous', role: 'viewer' };
}

export type PolicyAction = 'inventory.transfer.execute' | 'invoice.approve';

export function authorize(principal: Principal, action: PolicyAction): { allowed: boolean; reason?: string } {
  if (action === 'inventory.transfer.execute') {
    return principal.role === 'operator' || principal.role === 'finance-approver'
      ? { allowed: true }
      : { allowed: false, reason: 'operator_role_required' };
  }
  if (action === 'invoice.approve') {
    return principal.role === 'finance-approver'
      ? { allowed: true }
      : { allowed: false, reason: 'finance_approver_role_required' };
  }
  return { allowed: false, reason: 'policy_denied' };
}
