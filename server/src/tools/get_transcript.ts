import { ToolError } from '../errors.js';
import { getCall, type Turn } from '../store.js';

export interface GetTranscriptInput { call_id: string; }
export interface GetTranscriptOutput {
  call_id: string;
  turns: Turn[];
  duration_seconds: number;
}

export function validateGetTranscriptInput(input: Partial<GetTranscriptInput>): GetTranscriptInput {
  if (!input.call_id) throw new ToolError('invalid_input', 'call_id is required');
  return { call_id: input.call_id };
}

export async function getTranscript(raw: Partial<GetTranscriptInput>): Promise<GetTranscriptOutput> {
  const { call_id } = validateGetTranscriptInput(raw);
  const rec = await getCall(call_id);
  if (!rec) throw new ToolError('not_found', `Call ${call_id} not found`);
  return {
    call_id,
    turns: rec.transcript ?? [],
    duration_seconds: rec.duration_seconds ?? 0,
  };
}
