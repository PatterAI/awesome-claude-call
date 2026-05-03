export type ToolErrorCode =
  | 'credentials_missing'
  | 'credentials_invalid'
  | 'twilio_auth_failed'
  | 'tunnel_failed'
  | 'call_failed'
  | 'invalid_input'
  | 'not_found'
  | 'internal';

export interface ToolErrorPayload {
  error: ToolErrorCode;
  message: string;
  action?: string;
  details?: unknown;
}

export class ToolError extends Error {
  constructor(public code: ToolErrorCode, message: string, public action?: string, public details?: unknown) {
    super(message);
    this.name = 'ToolError';
  }

  toPayload(): ToolErrorPayload {
    return { error: this.code, message: this.message, action: this.action, details: this.details };
  }
}

export function asToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  if (err instanceof Error) {
    if (err.name === 'CredentialsError') {
      const code = (err as Error & { code?: string }).code === 'credentials_missing'
        ? 'credentials_missing' : 'credentials_invalid';
      const action = code === 'credentials_missing' ? 'Run /claude-call:setup' : undefined;
      return new ToolError(code, err.message, action);
    }
    if (err.name === 'AuthenticationError') {
      return new ToolError('twilio_auth_failed', err.message);
    }
    return new ToolError('internal', err.message, undefined, { stack: err.stack });
  }
  return new ToolError('internal', String(err));
}
