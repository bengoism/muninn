import type { RuntimeMode } from '../types/agent';

export const DEFAULT_BROWSER_URL =
  process.env.EXPO_PUBLIC_DEFAULT_URL ?? 'https://www.amazon.com';

export const DEFAULT_AGENT_GOAL =
  'find a good deal on mens socks';

export const DEFAULT_AGENT_RUNTIME_MODE: RuntimeMode =
  process.env.EXPO_PUBLIC_AGENT_RUNTIME_MODE === 'replay'
    ? 'replay'
    : 'litertlm';

export const DEFAULT_LITERT_LM_SMOKE_TEST_PROMPT =
  'Reply in one short sentence: confirm the model loaded successfully and answer what the capital of France is.';
