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
            editable: [],
            exploratoryOpeners: [],
            globalControls: [],
            mainContent: [],
            secondaryActions: [],
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
          editable: [
            {
              affordances: ['text_entry'],
              ancestorLandmarks: ['header'],
              capabilities: ['type'],
              containerId: null,
              containerKind: null,
              group: 'editable',
              id: 'e1',
              isPrimaryInContainer: false,
              label: 'Search Amazon',
              landmark: 'header',
              role: 'searchbox',
              targetType: 'semantic',
            },
            {
              affordances: ['text_entry'],
              ancestorLandmarks: ['main'],
              capabilities: ['type'],
              containerId: null,
              containerKind: null,
              group: 'editable',
              id: 'e2',
              isPrimaryInContainer: false,
              label: 'Search products',
              landmark: 'main',
              role: 'textbox',
              targetType: 'semantic',
            },
            {
              affordances: ['text_entry'],
              ancestorLandmarks: ['main'],
              capabilities: ['type'],
              containerId: null,
              containerKind: null,
              group: 'editable',
              id: 'e3',
              isPrimaryInContainer: false,
              label: 'Overflow input',
              landmark: 'main',
              role: 'textbox',
              targetType: 'semantic',
            },
          ],
          exploratoryOpeners: [
            {
              affordances: ['exploratory_opener'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: null,
              containerKind: null,
              group: 'exploratory_opener',
              id: 'e10',
              isPrimaryInContainer: false,
              label: 'From Stockholm',
              landmark: 'main',
              role: 'generic',
              targetType: 'generic',
            },
            {
              affordances: ['exploratory_opener'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: null,
              containerKind: null,
              group: 'exploratory_opener',
              id: 'e11',
              isPrimaryInContainer: false,
              label: 'To New York',
              landmark: 'main',
              role: 'generic',
              targetType: 'generic',
            },
            {
              affordances: ['exploratory_opener'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: null,
              containerKind: null,
              group: 'exploratory_opener',
              id: 'e12',
              isPrimaryInContainer: false,
              label: 'Overflow opener',
              landmark: 'main',
              role: 'generic',
              targetType: 'generic',
            },
          ],
          globalControls: [
            {
              affordances: ['navigation_leaf'],
              ancestorLandmarks: ['header'],
              capabilities: ['click'],
              containerId: null,
              containerKind: null,
              group: 'global_control',
              id: 'e20',
              isPrimaryInContainer: false,
              label: 'Home',
              landmark: 'header',
              role: 'link',
              targetType: 'semantic',
            },
            {
              affordances: ['navigation_leaf'],
              ancestorLandmarks: ['header'],
              capabilities: ['click'],
              containerId: null,
              containerKind: null,
              group: 'global_control',
              id: 'e21',
              isPrimaryInContainer: false,
              label: 'Orders',
              landmark: 'header',
              role: 'link',
              targetType: 'semantic',
            },
            {
              affordances: ['navigation_leaf'],
              ancestorLandmarks: ['header'],
              capabilities: ['click'],
              containerId: null,
              containerKind: null,
              group: 'global_control',
              id: 'e22',
              isPrimaryInContainer: false,
              label: 'Overflow nav',
              landmark: 'header',
              role: 'link',
              targetType: 'semantic',
            },
          ],
          mainContent: [
            {
              affordances: ['navigation_leaf'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: 'card-1',
              containerKind: 'card',
              group: 'main_content',
              id: 'e30',
              isPrimaryInContainer: true,
              label: 'Primary product title',
              landmark: 'main',
              role: 'link',
              targetType: 'semantic',
            },
            {
              affordances: ['navigation_leaf'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: 'card-2',
              containerKind: 'card',
              group: 'main_content',
              id: 'e31',
              isPrimaryInContainer: true,
              label: 'Second product title',
              landmark: 'main',
              role: 'link',
              targetType: 'semantic',
            },
            {
              affordances: ['navigation_leaf'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: 'card-3',
              containerKind: 'card',
              group: 'main_content',
              id: 'e32',
              isPrimaryInContainer: true,
              label: 'Third product title',
              landmark: 'main',
              role: 'link',
              targetType: 'semantic',
            },
            {
              affordances: ['navigation_leaf'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: 'card-4',
              containerKind: 'card',
              group: 'main_content',
              id: 'e33',
              isPrimaryInContainer: true,
              label: 'Overflow product title',
              landmark: 'main',
              role: 'link',
              targetType: 'semantic',
            },
          ],
          secondaryActions: [
            {
              affordances: ['direct_action'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: 'card-1',
              containerKind: 'card',
              group: 'secondary_action',
              id: 'e40',
              isPrimaryInContainer: false,
              label: 'Add to cart',
              landmark: 'main',
              role: 'button',
              targetType: 'semantic',
            },
            {
              affordances: ['direct_action'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: 'card-2',
              containerKind: 'card',
              group: 'secondary_action',
              id: 'e41',
              isPrimaryInContainer: false,
              label: 'Buy now',
              landmark: 'main',
              role: 'button',
              targetType: 'semantic',
            },
            {
              affordances: ['direct_action'],
              ancestorLandmarks: ['main'],
              capabilities: ['click'],
              containerId: 'card-3',
              containerKind: 'card',
              group: 'secondary_action',
              id: 'e42',
              isPrimaryInContainer: false,
              label: 'Overflow action',
              landmark: 'main',
              role: 'button',
              targetType: 'semantic',
            },
          ],
        },
      }),
    );

    expect(reduced.planningContext).toBeNull();
    expect(reduced.targetSummary).not.toBeNull();
    expect(reduced.targetSummary?.editable.map((entry) => entry.id)).toEqual([
      'e1',
      'e2',
    ]);
    expect(reduced.targetSummary?.mainContent.map((entry) => entry.id)).toEqual([
      'e30',
      'e31',
      'e32',
    ]);
    expect(
      reduced.targetSummary?.exploratoryOpeners.map((entry) => entry.id),
    ).toEqual(['e10', 'e11']);
    expect(
      reduced.targetSummary?.secondaryActions.map((entry) => entry.id),
    ).toEqual(['e40', 'e41']);
    expect(
      reduced.targetSummary?.globalControls.map((entry) => entry.id),
    ).toEqual(['e20', 'e21']);
    expect(reduced.actionHistory).toHaveLength(2);
    expect(reduced.axTreeText.length).toBeLessThan(4000);
    expect(reduced.axTreeText).toContain('truncated for fallback');
  });
});
