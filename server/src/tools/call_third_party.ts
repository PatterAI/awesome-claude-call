import { Tool } from 'getpatter';
import { ToolError } from '../errors.js';
import type { PatterContext } from '../patter.js';
import { makeCall, type MakeCallOutput } from './make_call.js';
import { logEvent } from '../log.js';

const E164 = /^\+[1-9]\d{1,14}$/;
const OBJECTIVE_MAX = 2000;

export interface CallThirdPartyInput {
  to: string;
  objective: string;
  max_turns?: number;
}

export interface CallThirdPartyInputValidated {
  to: string;
  objective: string;
  max_turns: number;
}

export interface CallThirdPartyOutput extends MakeCallOutput {
  outcome: 'success' | 'failure' | 'unclear';
  summary: string;
  structured: Record<string, unknown> | null;
}

export function validateCallThirdPartyInput(
  input: Partial<CallThirdPartyInput>,
): CallThirdPartyInputValidated {
  if (!input.to || !E164.test(input.to)) {
    throw new ToolError('invalid_input', 'to must be E.164 (e.g. +15551234567)');
  }
  if (!input.objective || input.objective.trim().length === 0) {
    throw new ToolError('invalid_input', 'objective is required');
  }
  if (input.objective.length > OBJECTIVE_MAX) {
    throw new ToolError('invalid_input', `objective exceeds ${OBJECTIVE_MAX} chars`);
  }
  const requested = input.max_turns ?? 10;
  const max_turns = Math.max(1, Math.min(30, requested));
  return { to: input.to, objective: input.objective.trim(), max_turns };
}

const SYSTEM_TEMPLATE = (objective: string, maxTurns: number): string =>
  `You are an AI assistant making a phone call to pursue a single objective.

OBJECTIVE: ${objective}

You have at most ${maxTurns} turns. Be polite, concise, and stay on objective.

When the call is about to end, call the report_outcome tool exactly once with:
- outcome: "success" if the objective was achieved, "failure" if it was not, "unclear" if the situation is ambiguous.
- summary: 1-2 sentences describing what happened.
- structured: an object with the key facts (e.g. {time: "20:00", confirmation: "ABC123"}). Use {} if none.

Do NOT speak the JSON; the tool call is silent. After calling report_outcome, say goodbye and end the call.`;

export async function callThirdParty(
  ctx: PatterContext,
  raw: Partial<CallThirdPartyInput>,
): Promise<CallThirdPartyOutput> {
  const input = validateCallThirdPartyInput(raw);

  let outcome: CallThirdPartyOutput['outcome'] = 'unclear';
  let summary = 'Call ended without structured outcome';
  let structured: Record<string, unknown> | null = null;

  const reportOutcome = new Tool({
    name: 'report_outcome',
    description:
      'Report the final outcome of the call. Call exactly once before saying goodbye.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['success', 'failure', 'unclear'] },
        summary: { type: 'string' },
        structured: { type: 'object' },
      },
      required: ['outcome', 'summary'],
    },
    handler: async (args: Record<string, unknown>) => {
      outcome = (args.outcome as typeof outcome) ?? 'unclear';
      summary = String(args.summary ?? summary);
      structured = (args.structured as Record<string, unknown> | undefined) ?? null;
      void logEvent({ event: 'outcome_reported', outcome, summary });
      return 'Outcome recorded.';
    },
  });

  const result = await makeCall(ctx, {
    to: input.to,
    system_prompt: SYSTEM_TEMPLATE(input.objective, input.max_turns),
    first_message: undefined,
    tools: [reportOutcome],
  });

  return { ...result, outcome, summary, structured };
}
