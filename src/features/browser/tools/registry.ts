import type { ToolName } from '../../../types/agent';
import type { ToolDefinition } from './types';

export const TOOL_REGISTRY: Record<ToolName, ToolDefinition> = {
  click: {
    name: 'click',
    params: { id: { type: 'string', required: true } },
    terminal: false,
    requiresBrowser: true,
  },
  tap_coordinates: {
    name: 'tap_coordinates',
    params: {
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
    },
    terminal: false,
    requiresBrowser: true,
  },
  type: {
    name: 'type',
    params: {
      id: { type: 'string', required: true },
      text: { type: 'string', required: true },
    },
    terminal: false,
    requiresBrowser: true,
  },
  fill: {
    name: 'fill',
    params: {
      id: { type: 'string', required: true },
      text: { type: 'string', required: true },
    },
    terminal: false,
    requiresBrowser: true,
  },
  select: {
    name: 'select',
    params: {
      id: { type: 'string', required: true },
      value: { type: 'string', required: true },
    },
    terminal: false,
    requiresBrowser: true,
  },
  scroll: {
    name: 'scroll',
    params: {
      direction: { type: 'string', required: true },
      amount: { type: 'string', required: true },
    },
    terminal: false,
    requiresBrowser: true,
  },
  go_back: {
    name: 'go_back',
    params: {},
    terminal: false,
    requiresBrowser: true,
  },
  wait: {
    name: 'wait',
    params: {
      condition: { type: 'string', required: false },
      timeout: { type: 'number', required: false },
    },
    terminal: false,
    requiresBrowser: true,
  },
  yield_to_user: {
    name: 'yield_to_user',
    params: { reason: { type: 'string', required: true } },
    terminal: true,
    requiresBrowser: false,
  },
  finish: {
    name: 'finish',
    params: {
      status: { type: 'string', required: true },
      message: { type: 'string', required: true },
    },
    terminal: true,
    requiresBrowser: false,
  },
};

export function validateToolParams(
  action: ToolName,
  params: Record<string, unknown>
): { valid: true } | { valid: false; reason: string } {
  const definition = TOOL_REGISTRY[action];
  if (!definition) {
    return { valid: false, reason: `Unknown action: ${action}` };
  }

  for (const [key, schema] of Object.entries(definition.params)) {
    if (!schema.required) continue;
    const value = params[key];
    if (value === undefined || value === null) {
      return { valid: false, reason: `Missing required parameter: ${key}` };
    }
    if (schema.type === 'string' && typeof value !== 'string') {
      return { valid: false, reason: `Parameter ${key} must be a string` };
    }
    if (schema.type === 'number' && typeof value !== 'number') {
      return { valid: false, reason: `Parameter ${key} must be a number` };
    }
  }

  return { valid: true };
}
