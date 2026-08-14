import type { Domain } from './types.js';

const rules: Array<[Domain, RegExp]> = [
  ['financials', /invoice|payment|refund|credit|financial/i],
  ['purchasing', /supplier|purchase|\bpo-?\d+\b/i],
  ['manufacturing', /production|manufactur|work order|\bmo-?\d+\b/i],
  ['inventory', /inventory|stock|warehouse|short|sku/i],
  ['orders', /order|customer|\bso-?\d+\b/i]
];

export function routeIntent(input: string): Domain {
  for (const [domain, pattern] of rules) if (pattern.test(input)) return domain;
  return 'unknown';
}
