import { BROWSER_BRIDGE_CHANNEL, parseBrowserBridgeMessage } from '../protocol';

const baseEnvelope = {
  channel: BROWSER_BRIDGE_CHANNEL,
  frame: {
    frameId: 'main-1',
    isTopFrame: true,
    readyState: 'complete',
    title: 'Example',
    url: 'https://example.com',
  },
  timestamp: '2026-04-08T10:00:00.000Z',
};

describe('parseBrowserBridgeMessage', () => {
  it('parses console_message payloads', () => {
    const raw = JSON.stringify({
      ...baseEnvelope,
      kind: 'console_message',
      payload: {
        args: ['hello', { value: 1 }],
        level: 'warn',
      },
    });

    const parsed = parseBrowserBridgeMessage(raw);
    expect(parsed && 'kind' in parsed ? parsed.kind : null).toBe('console_message');
  });

  it('parses network_summary payloads', () => {
    const raw = JSON.stringify({
      ...baseEnvelope,
      kind: 'network_summary',
      payload: {
        durationMs: 120,
        error: null,
        method: 'GET',
        phase: 'completed',
        requestId: 'fetch-main-1',
        statusCode: 200,
        transport: 'fetch',
        url: 'https://example.com/api',
      },
    });

    const parsed = parseBrowserBridgeMessage(raw);
    expect(parsed && 'kind' in parsed ? parsed.kind : null).toBe('network_summary');
  });
});
