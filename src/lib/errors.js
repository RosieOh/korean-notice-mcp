export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function fail(code, message) { throw new ToolError(code, message); }
