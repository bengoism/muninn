import type { InferenceFailure, InferenceRequest } from '../../../../types/agent';
import {
  buildReducedInferenceRequest,
  canReduceInferenceRequest,
  shouldRetryInferenceWithReducedContext,
} from '../inference-fallback';

function makeRequest(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    actionHistory: [],
    axSnapshot: [],
    axTreeText: '- root\n  - link "Example" [ref=e1]',
    goal: 'find a good deal on mens socks',
    planningContext: null,
    runtimeMode: 'litertlm',
    screenshotUri: 'file:///tmp/test.jpg',
    sessionPlan: null,
    targetSummary: null,
    ...overrides,
  };
}

function makeFailure(
  overrides: Partial<InferenceFailure> = {},
): InferenceFailure {
  return {
    backend: 'cpu',
    code: 'model_load_failed',
    details: null,
    message: 'conversation_send_message=null',
    ok: false,
    retryable: false,
    ...overrides,
  };
}

describe('inference fallback', () => {
  it('retries reduced context for conversation_send_message failures', () => {
    expect(shouldRetryInferenceWithReducedContext(makeFailure())).toBe(true);
    expect(
      shouldRetryInferenceWithReducedContext(
        makeFailure({
          message: 'Model failed',
          details: {
            adapterUserInfo: {
              NSLocalizedDescription: 'conversation_send_message=null',
            },
          },
        }),
      ),
    ).toBe(true);
    expect(
      shouldRetryInferenceWithReducedContext(
        makeFailure({
          code: 'invalid_model_output',
          message: 'bad json',
        }),
      ),
    ).toBe(false);
  });

  it('detects when request can be reduced', () => {
    expect(
      canReduceInferenceRequest(
        makeRequest({
          targetSummary: {
            intent: 'open_target',
            editable: [],
            exploratory: [],
            lowerPriority: [],
            preferred: [],
          },
        }),
      ),
    ).toBe(true);
    expect(
      canReduceInferenceRequest(
        makeRequest({
          axTreeText: 'short tree',
        }),
      ),
    ).toBe(false);
  });

  it('drops optional context for reduced retry', () => {
    const reduced = buildReducedInferenceRequest(
      makeRequest({
        actionHistory: [
          {
            action: 'click',
            fallbackChain: [],
            parameters: { id: 'e1' },
            reason: null,
            retryOf: undefined,
            status: 'succeeded',
            timestamp: '2026-04-09T00:00:00.000Z',
            urlAfter: 'https://example.com',
            urlBefore: 'https://example.com',
          },
          {
            action: 'click',
            fallbackChain: [],
            parameters: { id: 'e2' },
            reason: null,
            retryOf: undefined,
            status: 'failed',
            timestamp: '2026-04-09T00:00:01.000Z',
            urlAfter: 'https://example.com',
            urlBefore: 'https://example.com',
          },
          {
            action: 'click',
            fallbackChain: [],
            parameters: { id: 'e3' },
            reason: null,
            retryOf: undefined,
            status: 'failed',
            timestamp: '2026-04-09T00:00:02.000Z',
            urlAfter: 'https://example.com',
            urlBefore: 'https://example.com',
          },
        ],
        axTreeText: 'x'.repeat(4000),
        planningContext: {
          fullPageScreenshotUri: 'file:///tmp/full.jpg',
          reasons: ['post_navigation'],
          summary: 'Need overview',
        },
        targetSummary: {
          intent: 'open_target',
          editable: [],
          exploratory: [],
          lowerPriority: [],
          preferred: [],
        },
      }),
    );

    expect(reduced.planningContext).toBeNull();
    expect(reduced.targetSummary).toBeNull();
    expect(reduced.actionHistory).toHaveLength(2);
    expect(reduced.axTreeText.length).toBeLessThan(4000);
    expect(reduced.axTreeText).toContain('truncated for fallback');
  });
});
