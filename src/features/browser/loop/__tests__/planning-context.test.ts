import type {
  AgentActionRecord,
  ObservationResult,
  PlanningContextDebugRequest,
  SessionPlan,
} from '../../../../types/agent';
import {
  decidePlanningContextRequest,
  finalizePlanningContextRequest,
  toInferencePlanningContext,
} from '../planning-context';
import { createSessionPlan, reduceSessionPlan } from '../planning';

function makeObservationResult(
  overrides: Partial<ObservationResult> = {},
): ObservationResult {
  return {
    axSnapshot: [],
    axTreeText: '',
    debug: {
      combinedRefMap: {},
      expectedFrameIds: [],
      frameArtifacts: [],
      timedOut: false,
    },
    frameSnapshots: [],
    fullPageScreenshot: null,
    observedAt: '2026-04-08T00:00:00.000Z',
    quiescence: {
      idleThresholdMs: 300,
      lastActivityAt: null,
      observedFrameCount: 1,
      satisfied: true,
      timedOut: false,
      waitTimeMs: 300,
    },
    screenshot: {
      capturedAt: '2026-04-08T00:00:00.000Z',
      height: 100,
      orientation: 'portrait',
      pointHeight: 100,
      pointWidth: 100,
      scale: 1,
      uri: 'file:///tmp/viewport.png',
      width: 100,
    },
    warnings: [],
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<AgentActionRecord> = {},
): AgentActionRecord {
  return {
    action: 'click',
    parameters: { id: 'e1' },
    reason: null,
    status: 'succeeded',
    timestamp: '2026-04-08T00:00:00.000Z',
    urlAfter: 'https://example.com',
    urlBefore: 'https://example.com',
    ...overrides,
  };
}

function makeResultsPlan(): SessionPlan {
  return reduceSessionPlan(createSessionPlan('find mens socks'), {
    type: 'observation',
    goal: 'find mens socks',
    observation: makeObservationResult({
      axTreeText: '- heading "Results" [ref=e1]',
      debug: {
        combinedRefMap: {
          e1: {
            domId: 'heading',
            label: 'Results',
            role: 'heading',
            selector: 'h2',
          },
        },
        expectedFrameIds: [],
        frameArtifacts: [],
        timedOut: false,
      },
    }),
    stepIndex: 1,
    timestamp: '2026-04-08T00:00:00.000Z',
    url: 'https://www.amazon.com/s?k=mens+socks',
  });
}

describe('planning rich context policy', () => {
  it('requests planning context after navigation', () => {
    const request = decidePlanningContextRequest({
      actionHistory: [
        makeRecord({
          action: 'click',
          urlBefore: 'https://www.amazon.com/',
          urlAfter: 'https://www.amazon.com/s?k=mens+socks',
        }),
      ],
      currentUrl: 'https://www.amazon.com/s?k=mens+socks',
      debugRawEnabled: false,
      plan: makeResultsPlan(),
      previousObservation: null,
      previousRequest: null,
      stepIndex: 2,
    });

    expect(request).toMatchObject({
      source: 'planning',
      reasons: ['post_navigation'],
    });
  });

  it('requests planning context for sparse refs on rich phases', () => {
    const request = decidePlanningContextRequest({
      actionHistory: [makeRecord(), makeRecord()],
      currentUrl: 'https://www.amazon.com/s?k=mens+socks',
      debugRawEnabled: false,
      plan: makeResultsPlan(),
      previousObservation: makeObservationResult({
        debug: {
          combinedRefMap: {
            e1: {
              domId: 'heading',
              label: 'Results',
              role: 'heading',
              selector: 'h2',
            },
          },
          expectedFrameIds: [],
          frameArtifacts: [],
          timedOut: false,
        },
      }),
      previousRequest: null,
      stepIndex: 3,
    });

    expect(request?.reasons).toContain('sparse_refs');
    expect(request?.reasons).toContain('plan_ambiguity');
  });

  it('dedupes identical planning requests on consecutive steps', () => {
    const previousRequest: PlanningContextDebugRequest = {
      fullPageCaptured: true,
      fullPageScreenshotUri: 'file:///tmp/full.png',
      reasons: ['post_navigation'],
      source: 'planning',
      step: 2,
      summary: 'A navigation just completed.',
      url: 'https://www.amazon.com/s?k=mens+socks',
    };

    const request = decidePlanningContextRequest({
      actionHistory: [
        makeRecord({
          urlBefore: 'https://www.amazon.com/',
          urlAfter: 'https://www.amazon.com/s?k=mens+socks',
        }),
      ],
      currentUrl: 'https://www.amazon.com/s?k=mens+socks',
      debugRawEnabled: false,
      plan: makeResultsPlan(),
      previousObservation: null,
      previousRequest,
      stepIndex: 3,
    });

    expect(request).toBeNull();
  });

  it('preserves debug-only full-page capture without sending inference context', () => {
    const request = decidePlanningContextRequest({
      actionHistory: [],
      currentUrl: 'https://www.amazon.com/',
      debugRawEnabled: true,
      plan: createSessionPlan('find mens socks'),
      previousObservation: null,
      previousRequest: null,
      stepIndex: 1,
    });

    expect(request).toMatchObject({
      source: 'debug_raw',
      reasons: [],
    });
    expect(toInferencePlanningContext(request)).toBeNull();
  });

  it('promotes a captured planning request into inference context', () => {
    const request = decidePlanningContextRequest({
      actionHistory: [
        makeRecord({
          urlBefore: 'https://www.amazon.com/',
          urlAfter: 'https://www.amazon.com/s?k=mens+socks',
        }),
      ],
      currentUrl: 'https://www.amazon.com/s?k=mens+socks',
      debugRawEnabled: false,
      plan: makeResultsPlan(),
      previousObservation: null,
      previousRequest: null,
      stepIndex: 2,
    });

    const finalized = finalizePlanningContextRequest(
      request,
      makeObservationResult({
        fullPageScreenshot: {
          capturedAt: '2026-04-08T00:00:01.000Z',
          height: 1200,
          orientation: 'portrait',
          pointHeight: 1200,
          pointWidth: 100,
          scale: 1,
          tileCount: 4,
          uri: 'file:///tmp/full.png',
          viewportOriginX: 0,
          viewportOriginY: 200,
          viewportPointHeight: 100,
          viewportPointWidth: 100,
          width: 100,
        },
      }),
    );

    expect(toInferencePlanningContext(finalized)).toMatchObject({
      fullPageScreenshotUri: 'file:///tmp/full.png',
      reasons: ['post_navigation'],
    });
  });
});
