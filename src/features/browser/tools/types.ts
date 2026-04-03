import type { ToolName } from '../../../types/agent';

export type ToolParamSchema = Record<
  string,
  { type: 'string' | 'number'; required: boolean }
>;

export type ToolResult = {
  ok: boolean;
  action: ToolName;
  reason: string | null;
  durationMs: number;
};

export type ToolDefinition = {
  name: ToolName;
  params: ToolParamSchema;
  terminal: boolean;
  requiresBrowser: boolean;
};
