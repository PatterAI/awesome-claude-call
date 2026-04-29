export class ToolError extends Error {
    code;
    action;
    details;
    constructor(code, message, action, details) {
        super(message);
        this.code = code;
        this.action = action;
        this.details = details;
        this.name = 'ToolError';
    }
    toPayload() {
        return { error: this.code, message: this.message, action: this.action, details: this.details };
    }
}
export function asToolError(err) {
    if (err instanceof ToolError)
        return err;
    if (err instanceof Error) {
        if (err.name === 'CredentialsError') {
            const code = err.code === 'credentials_missing'
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
