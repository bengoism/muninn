import type { RuntimeMode } from '../types/agent';

export const DEFAULT_BROWSER_URL =
  process.env.EXPO_PUBLIC_DEFAULT_URL ?? 'https://example.com';

export const DEFAULT_AGENT_GOAL =
  'Open the current page and prepare the browser for the agent loop.';

export const DEFAULT_AGENT_RUNTIME_MODE: RuntimeMode =
  process.env.EXPO_PUBLIC_AGENT_RUNTIME_MODE === 'litertlm'
    ? 'litertlm'
    : 'replay';

export const DEFAULT_LITERT_LM_SMOKE_TEST_PROMPT =
  'Reply in one short sentence: confirm the model loaded successfully and answer what the capital of France is.';
