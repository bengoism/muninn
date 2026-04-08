import type {
  InferenceResponse,
  PlanningContextDebugRequest,
} from '../../../../types/agent';
import {
  downgradePlanningContextRequest,
  shouldRetryInferenceWithoutPlanningContext,
} from '../inference-fallback';

function makeFailure(
  overrides: Partial<Extract<InferenceResponse, { ok: false }>> = {},
): Extract<InferenceResponse, { ok: false }> {
  return {
    ok: false,
    backend: 'litertlm',
    code: 'model_load_failed',
    details: null,
    message: 'conversation_send_message=null',
    retryable: false,
    ...overrides,
  };
}

function makeSuccess(): Extract<InferenceResponse, { ok: true }> {
  return {
    ok: true,
    action: 'click',
    backend: 'litertlm',
    diagnostics: null,
    parameters: { id: 'e1' },
    planUpdates: null,
  };
}

function makeRequest(
  overrides: Partial<PlanningContextDebugRequest> = {},
): PlanningContextDebugRequest {
  return {
    fullPageCaptured: true,
    fullPageScreenshotUri: 'file:///tmp/full.png',
    reasons: ['post_navigation'],
    source: 'planning',
    step: 4,
    summary: 'A navigation just completed.',
    url: 'https://www.amazon.com/s?k=mens+socks',
    ...overrides,
  };
}

describe('inference fallback policy', () => {
  it('retries once without planning context when a planning-context inference fails', () => {
    expect(
      shouldRetryInferenceWithoutPlanningContext(makeFailure(), true),
    ).toBe(true);
  });

  it('does not retry successful responses', () => {
    expect(
      shouldRetryInferenceWithoutPlanningContext(makeSuccess(), true),
    ).toBe(false);
  });

  it('does not retry failures when no planning context was sent', () => {
    expect(
      shouldRetryInferenceWithoutPlanningContext(makeFailure(), false),
    ).toBe(false);
  });

  it('drops pure planning requests once planning context is disabled', () => {
    expect(
      downgradePlanningContextRequest(
        makeRequest({ source: 'planning' }),
        'model_load_failed: conversation_send_message=null',
      ),
    ).toBeNull();
  });

  it('downgrades planning-and-debug requests to debug-only when planning context is disabled', () => {
    expect(
      downgradePlanningContextRequest(
        makeRequest({
          reasons: ['post_navigation', 'repeated_failure'],
          source: 'planning_and_debug_raw',
        }),
        'model_load_failed: conversation_send_message=null',
      ),
    ).toMatchObject({
      reasons: [],
      source: 'debug_raw',
    });
  });
});
