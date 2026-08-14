import { z } from 'zod';
import type { Domain } from './types.js';

export const ModelDecisionSchema = z.object({
  domain: z.enum(['orders', 'inventory', 'purchasing', 'manufacturing', 'financials', 'unknown']),
  orderId: z.string().regex(/^SO-\d+$/).nullable(),
  requestedAction: z.enum(['analyze', 'transfer']).default('analyze'),
  rationale: z.string().min(1)
});

export type ModelDecision = z.infer<typeof ModelDecisionSchema>;

export interface ModelProvider {
  decide(input: string): Promise<unknown>;
}

export class DeterministicProvider implements ModelProvider {
  constructor(private readonly domain: Domain, private readonly malformed = false) {}

  async decide(input: string): Promise<unknown> {
    if (this.malformed) return { domain: 42, order: 'bad' };
    const orderId = input.match(/SO-\d+/i)?.[0].toUpperCase() ?? null;
    return {
      domain: this.domain,
      orderId,
      requestedAction: /transfer|move/i.test(input) ? 'transfer' : 'analyze',
      rationale: 'Deterministic provider used for reproducible evaluation.'
    };
  }
}

export async function getValidatedDecision(provider: ModelProvider, input: string): Promise<ModelDecision> {
  return ModelDecisionSchema.parse(await provider.decide(input));
}
