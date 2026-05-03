import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadCredentials, defaultCredentialsPath } from './credentials.js';
import { buildPatter, type PatterContext } from './patter.js';
import { asToolError, ToolError } from './errors.js';
import { logEvent } from './log.js';
import { makeCall, validateMakeCallInput } from './tools/make_call.js';
import { callThirdParty, validateCallThirdPartyInput } from './tools/call_third_party.js';
import { getCalls, validateGetCallsInput } from './tools/get_calls.js';
import { getTranscript, validateGetTranscriptInput } from './tools/get_transcript.js';
import { startInboundWatcher } from './inbound.js';
import { startFireQueueWatcher } from './fire-queue.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  needsPatter: boolean;
  validate: (args: Record<string, unknown>) => void;
  handler: (ctx: PatterContext, args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'make_call',
    description: 'Place an outbound voice call. Returns transcript and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'E.164 phone number, e.g. +15551234567' },
        system_prompt: { type: 'string', description: 'System prompt for the in-call agent' },
        first_message: { type: 'string' },
        recording: { type: 'boolean' },
        voicemail_message: { type: 'string' },
      },
      required: ['to', 'system_prompt'],
    },
    needsPatter: true,
    validate: (a) => { validateMakeCallInput(a as never); },
    handler: (ctx, a) => makeCall(ctx, a as never),
  },
  {
    name: 'call_third_party',
    description: 'Call a third party with an objective; returns structured outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        objective: { type: 'string' },
        max_turns: { type: 'number' },
      },
      required: ['to', 'objective'],
    },
    needsPatter: true,
    validate: (a) => { validateCallThirdPartyInput(a as never); },
    handler: (ctx, a) => callThirdParty(ctx, a as never),
  },
  {
    name: 'get_calls',
    description: 'List recent calls.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' }, since: { type: 'string' } },
    },
    needsPatter: false,
    validate: (a) => { validateGetCallsInput(a as never); },
    handler: (_ctx, a) => getCalls(a as never),
  },
  {
    name: 'get_transcript',
    description: 'Get full transcript of a previous call.',
    inputSchema: {
      type: 'object',
      properties: { call_id: { type: 'string' } },
      required: ['call_id'],
    },
    needsPatter: false,
    validate: (a) => { validateGetTranscriptInput(a as never); },
    handler: (_ctx, a) => getTranscript(a as never),
  },
];

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'claude-call', version: '0.2.2' },
    { capabilities: { tools: {} } },
  );

  let ctxPromise: Promise<PatterContext> | undefined;
  async function getCtx(): Promise<PatterContext> {
    if (!ctxPromise) {
      ctxPromise = (async () => {
        const creds = await loadCredentials();
        return buildPatter(creds);
      })();
    }
    return ctxPromise;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      const err = new ToolError('invalid_input', `Unknown tool: ${req.params.name}`);
      return { content: [{ type: 'text', text: JSON.stringify(err.toPayload()) }], isError: true };
    }
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      tool.validate(args);
      const ctx = tool.needsPatter ? await getCtx() : (undefined as unknown as PatterContext);
      const result = await tool.handler(ctx, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const toolErr = asToolError(err);
      void logEvent({ event: 'tool_error', tool: tool.name, code: toolErr.code, message: toolErr.message });
      return { content: [{ type: 'text', text: JSON.stringify(toolErr.toPayload()) }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  startInboundWatcher(getCtx);
  startFireQueueWatcher(getCtx);
  void logEvent({ event: 'mcp_server_started', credentials_path: defaultCredentialsPath() });
}
