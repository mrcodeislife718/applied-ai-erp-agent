export type FaultMode = 'none' | 'timeout' | 'unavailable' | 'malformed';

export class ToolFailure extends Error {
  constructor(public readonly code: 'timeout' | 'unavailable' | 'malformed_tool_result', message: string) {
    super(message);
  }
}

export type FaultPlan = Partial<Record<string, FaultMode[]>>;

export class FaultInjector {
  private readonly queues = new Map<string, FaultMode[]>();

  constructor(plan: FaultPlan = {}) {
    for (const [tool, modes] of Object.entries(plan)) this.queues.set(tool, [...(modes ?? [])]);
  }

  next(tool: string): FaultMode {
    const queue = this.queues.get(tool);
    return queue?.shift() ?? 'none';
  }
}

export type RetryPolicy = { maxAttempts: number; retryable: Array<ToolFailure['code']> };

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 2,
  retryable: ['timeout', 'unavailable']
};

export function invokeWithReliability<T>(
  toolName: string,
  fn: () => T,
  opts: { faults?: FaultInjector; policy?: RetryPolicy; onAttempt?: (attempt: number, outcome: string) => void } = {}
): T {
  const policy = opts.policy ?? defaultRetryPolicy;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const fault = opts.faults?.next(toolName) ?? 'none';
      if (fault === 'timeout') throw new ToolFailure('timeout', `${toolName} timed out`);
      if (fault === 'unavailable') throw new ToolFailure('unavailable', `${toolName} is unavailable`);
      const result = fn();
      if (fault === 'malformed') throw new ToolFailure('malformed_tool_result', `${toolName} returned malformed output`);
      opts.onAttempt?.(attempt, 'success');
      return result;
    } catch (error) {
      lastError = error;
      const code = error instanceof ToolFailure ? error.code : 'unknown';
      opts.onAttempt?.(attempt, code);
      if (!(error instanceof ToolFailure) || !policy.retryable.includes(error.code) || attempt >= policy.maxAttempts) throw error;
    }
  }

  throw lastError;
}
