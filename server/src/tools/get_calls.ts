import { ToolError } from '../errors.js';
import { listCalls, type CallRecord } from '../store.js';

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export interface GetCallsInput {
  limit?: number;
  since?: string;
}

export interface GetCallsValidated {
  limit: number;
  since?: string;
}

export interface GetCallsOutput {
  calls: CallRecord[];
}

export function validateGetCallsInput(input: Partial<GetCallsInput>): GetCallsValidated {
  const limit = Math.max(1, Math.min(200, input.limit ?? 20));
  if (input.since !== undefined && !ISO8601.test(input.since)) {
    throw new ToolError('invalid_input', 'since must be ISO8601 (e.g. 2026-04-28T10:00:00Z)');
  }
  return { limit, since: input.since };
}

export async function getCalls(raw: Partial<GetCallsInput>): Promise<GetCallsOutput> {
  const input = validateGetCallsInput(raw);
  const calls = await listCalls(input);
  return { calls };
}
