import type { ObservationResult, SessionPlan } from '../../../../types/agent';
import { repairGenericClickTarget } from '../semantic-target-repair';

function makeObservationResult(): ObservationResult {
  return {
    axSnapshot: [],
    axTreeText: [
      '- heading "Results" [level=2, ref=e17]',
      '- generic "COOPLUS 12 Pack Mens Cushioned Ankle Socks Add to cart" [ref=e20] clickable [cursor:pointer, exploratory]',
      '- link "Go to detail page for COOPLUS 12 Pack Mens Cushioned Ankle Socks" [ref=e29]',
      '- link "COOPLUS 12 Pack Mens Cushioned Ankle Socks" [ref=e31]',
    ].join('\n'),
    debug: {
      combinedRefMap: {
        e20: {
          domId: 'ai-main-product-20',
          label: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks Add to cart',
          role: 'generic',
          selector: 'span',
          targetType: 'generic',
          text: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks Add to cart',
        },
        e29: {
          domId: 'ai-main-detail-29',
          href: 'https://www.amazon.com/dp/B0TEST',
          label: 'Go to detail page for COOPLUS 12 Pack Mens Cushioned Ankle Socks',
          role: 'link',
          selector: 'a[href]',
          targetType: 'semantic',
          text: 'Go to detail page for COOPLUS 12 Pack Mens Cushioned Ankle Socks',
        },
        e31: {
          domId: 'ai-main-title-31',
          href: 'https://www.amazon.com/dp/B0TEST',
          label: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
          role: 'link',
          selector: 'a[href]',
          targetType: 'semantic',
          text: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
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
  it('redirects a generic result-card click to a semantic detail link', () => {
    const repair = repairGenericClickTarget({
      action: 'click',
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult(),
      params: { id: 'e20' },
      plan: makePlan(),
      targetState: 'known_ref',
    });

    expect(repair).toMatchObject({
      action: 'click',
      candidateRef: 'e29',
      params: { id: 'e29' },
      targetRef: 'e20',
    });
    expect(repair?.score ?? 0).toBeGreaterThanOrEqual(120);
  });
});
