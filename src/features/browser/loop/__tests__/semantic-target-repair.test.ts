import type { ObservationResult, SessionPlan } from '../../../../types/agent';
import { repairGenericClickTarget } from '../semantic-target-repair';

function makeObservationResult(): ObservationResult {
  return {
    axSnapshot: [],
    axTreeText: [
      '- link "COOPLUS 12 Pack Mens Cushioned Ankle Socks" [ref=e26]',
      '- button "Add to cart" [ref=e30]',
    ].join('\n'),
    debug: {
      combinedRefMap: {
        e26: {
          ancestorLandmarks: ['main'],
          containerId: 'card-1',
          containerKind: 'card',
          domId: 'ai-main-detail-26',
          href: 'https://www.example.com/item/1',
          label: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
          landmark: 'main',
          role: 'link',
          selector: 'a[href]',
          targetType: 'semantic',
          text: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
        },
        e30: {
          ancestorLandmarks: ['main'],
          containerId: 'card-1',
          containerKind: 'card',
          domId: 'ai-main-cart-30',
          label: 'Add to cart',
          landmark: 'main',
          role: 'button',
          selector: 'button',
          targetType: 'semantic',
          text: 'Add to cart',
        },
      },
      expectedFrameIds: [],
      frameArtifacts: [],
      timedOut: false,
    },
    frameSnapshots: [],
    fullPageScreenshot: null,
    observedAt: '2026-04-09T00:00:00.000Z',
    quiescence: {
      idleThresholdMs: 300,
      lastActivityAt: null,
      observedFrameCount: 1,
      satisfied: true,
      timedOut: false,
      waitTimeMs: 300,
    },
    screenshot: {
      capturedAt: '2026-04-09T00:00:00.000Z',
      height: 100,
      orientation: 'portrait',
      pointHeight: 100,
      pointWidth: 100,
      scale: 1,
      uri: 'file:///tmp/test.png',
      width: 100,
    },
    warnings: [],
  };
}

function makePlan(): SessionPlan {
  return {
    activeItemId: 'todo-results',
    avoidRefs: [],
    items: [
      {
        createdAt: '2026-04-09T00:00:00.000Z',
        evidence: null,
        id: 'todo-results',
        source: 'system',
        status: 'in_progress',
        text: 'Open a relevant result for: find a good deal on mens socks',
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
    ],
    lastConfirmedProgress: null,
    notes: [],
    phase: 'results',
    updatedAt: '2026-04-09T00:00:00.000Z',
  };
}

describe('repairGenericClickTarget', () => {
  it('redirects a secondary card action to the card primary target', () => {
    const repair = repairGenericClickTarget({
      action: 'click',
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult(),
      params: { id: 'e30' },
      plan: makePlan(),
      targetState: 'known_ref',
    });

    expect(repair).toMatchObject({
      action: 'click',
      candidateRef: 'e26',
      params: { id: 'e26' },
      targetRef: 'e30',
    });
    expect(repair?.score ?? 0).toBeGreaterThanOrEqual(120);
  });
});
