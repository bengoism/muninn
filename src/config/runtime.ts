import type { RuntimeMode } from '../types/agent';

export const DEFAULT_BROWSER_URL =
  process.env.EXPO_PUBLIC_DEFAULT_URL ?? 'https://example.com';

export const DEFAULT_AGENT_GOAL =
  'Open the current page and prepare the browser for the agent loop.';

export const DEFAULT_AGENT_RUNTIME_MODE: RuntimeMode =
  process.env.EXPO_PUBLIC_AGENT_RUNTIME_MODE === 'litertlm'
    ? 'litertlm'
    : 'replay';
