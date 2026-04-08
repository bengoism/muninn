import type {
  ObservationResult,
  SessionPlan,
} from '../../../../types/agent';
import type { ValidationResult, ValidationSnapshot } from '../../tools/types';
import {
  addAvoidRef,
  createSessionPlan,
  findActiveAvoidRef,
  reduceSessionPlan,
} from '../planning';
import { shouldBlockFinishSuccess } from '../planning-guards';

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
      uri: 'file:///tmp/test.png',
      width: 100,
    },
    warnings: [],
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ValidationSnapshot> = {},
): ValidationSnapshot {
  return {
    activeShortRef: null,
    axNodeBounds: new Map(),
    axNodeCount: 0,
    axNodeIds: new Set(),
    axNodeRoles: new Map(),
    focusedElementId: null,
    hasDialog: false,
    isLoading: false,
    knownRefIds: new Set(),
    liveRefIds: new Set(),
    refToDomId: new Map(),
    scrollY: 0,
    timestamp: Date.now(),
    url: 'https://example.com',
    ...overrides,
  };
}

function makeValidation(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    outcome: 'success',
    reason: null,
    signals: {
      axDelta: { added: 0, removed: 0, total: 0 },
      focusChanged: false,
      loadingChanged: false,
      scrollChanged: false,
      targetStillPresent: true,
      targetWasKnown: true,
      urlChanged: false,
    },
    ...overrides,
  };
}

function findItem(plan: SessionPlan, id: string) {
  return plan.items.find((item) => item.id === id);
}

describe('session planning', () => {
  it('creates an initial runtime-owned plan with one active item', () => {
    const plan = createSessionPlan(
      'find a good deal on mens socks',
      '2026-04-08T00:00:00.000Z',
    );

    expect(plan.phase).toBe('initial');
    expect(plan.activeItemId).toBe('todo-start');
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      id: 'todo-start',
      status: 'in_progress',
      text: 'Make initial progress toward: find a good deal on mens socks',
    });
  });

  it('transitions to results and activates a result-selection todo', () => {
    const plan = createSessionPlan('find mens socks');
    const resultsObservation = makeObservationResult({
      axTreeText: [
        '- heading "Results" [level=2, ref=e1]',
        '- generic "Amazon Essentials Mens Socks Add to cart" [ref=e2] clickable',
      ].join('\n'),
      debug: {
        combinedRefMap: {
          e1: {
            domId: 'heading-1',
            label: 'Results',
            role: 'heading',
            selector: 'h2',
          },
          e2: {
            domId: 'product-1',
            label: 'Amazon Essentials Mens Socks',
            role: 'generic',
            selector: 'div',
          },
        },
        expectedFrameIds: [],
        frameArtifacts: [],
        timedOut: false,
      },
    });

    const next = reduceSessionPlan(plan, {
      type: 'observation',
      goal: 'find mens socks',
      observation: resultsObservation,
      stepIndex: 1,
      timestamp: resultsObservation.observedAt,
      url: 'https://www.amazon.com/s?k=mens+socks',
    });

    expect(next.phase).toBe('results');
    expect(next.activeItemId).toBe('todo-results');
    expect(findItem(next, 'todo-start')).toMatchObject({
      status: 'completed',
    });
    expect(findItem(next, 'todo-results')).toMatchObject({
      status: 'in_progress',
      text: 'Open a relevant result for: find mens socks',
    });
  });

  it('records evidence-backed progress from successful actions', () => {
    const plan = createSessionPlan('find mens socks');
    const next = reduceSessionPlan(plan, {
      type: 'action_validated',
      action: 'type',
      goal: 'find mens socks',
      params: { id: 'e6', text: 'mens socks' },
      postSnapshot: makeSnapshot({
        focusedElementId: 'search-input',
      }),
      preSnapshot: makeSnapshot(),
      stepIndex: 1,
      timestamp: '2026-04-08T00:00:03.000Z',
      validation: makeValidation({
        signals: {
          axDelta: { added: 0, removed: 0, total: 0 },
          focusChanged: true,
          loadingChanged: false,
          scrollChanged: false,
          targetStillPresent: true,
          targetWasKnown: true,
          urlChanged: false,
        },
      }),
    });

    expect(next.lastConfirmedProgress).toBe(
      'Entered "mens socks" into a page field.',
    );
    expect(findItem(next, 'todo-start')?.evidence).toBe(
      'Entered "mens socks" into a page field.',
    );
  });

  it('detects form-like observation state for modal and picker flows', () => {
    const plan = createSessionPlan('find a flight from stockholm to nyc');
    const next = reduceSessionPlan(plan, {
      type: 'observation',
      goal: 'find a flight from stockholm to nyc',
      observation: makeObservationResult({
        axTreeText: [
          '- textbox "Origin" [ref=e1]',
          '- textbox "Destination" [ref=e2]',
          '- button "Departure" [ref=e3]',
        ].join('\n'),
        debug: {
          combinedRefMap: {
            e1: {
              domId: 'origin-input',
              label: 'Origin',
              role: 'textbox',
              selector: 'input[name="origin"]',
            },
            e2: {
              domId: 'destination-input',
              label: 'Destination',
              role: 'textbox',
              selector: 'input[name="destination"]',
            },
            e3: {
              domId: 'departure-button',
              label: 'Departure',
              role: 'button',
              selector: 'button[name="departure"]',
            },
          },
          expectedFrameIds: [],
          frameArtifacts: [],
          timedOut: false,
        },
      }),
      stepIndex: 1,
      timestamp: '2026-04-08T00:00:00.000Z',
      url: 'https://www.google.com/travel/flights',
    });

    expect(next.phase).toBe('form');
    expect(next.activeItemId).toBe('todo-form');
    expect(findItem(next, 'todo-form')).toMatchObject({
      status: 'in_progress',
    });
  });

  it('classifies search-heavy homepages as search instead of form', () => {
    const plan = createSessionPlan('find a good deal on mens socks');
    const next = reduceSessionPlan(plan, {
      type: 'observation',
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult({
        axTreeText: [
          '- header',
          '  - searchbox "Search Amazon" [ref=e1]',
          '  - link "Deals" [ref=e2]',
          '  - link "Best Sellers" [ref=e3]',
          '- text "Deliver to Sweden"',
        ].join('\n'),
        debug: {
          combinedRefMap: {
            e1: {
              domId: 'search-input',
              label: 'Search Amazon',
              role: 'searchbox',
              selector: 'input[role="searchbox"]',
            },
            e2: { domId: 'deals', label: 'Deals', role: 'link', selector: 'a' },
            e3: {
              domId: 'best-sellers',
              label: 'Best Sellers',
              role: 'link',
              selector: 'a',
            },
            e4: { domId: 'account', label: 'Sign in', role: 'link', selector: 'a' },
            e5: { domId: 'cart', label: 'Cart', role: 'link', selector: 'a' },
            e6: { domId: 'menu', label: 'Menu', role: 'button', selector: 'button' },
            e7: { domId: 'video', label: 'Video', role: 'link', selector: 'a' },
            e8: { domId: 'music', label: 'Music', role: 'link', selector: 'a' },
          },
          expectedFrameIds: [],
          frameArtifacts: [],
          timedOut: false,
        },
      }),
      stepIndex: 1,
      timestamp: '2026-04-08T00:00:00.000Z',
      url: 'https://www.amazon.com/',
    });

    expect(next.phase).toBe('search');
    expect(next.activeItemId).toBe('todo-start');
  });

  it('blocks premature finish on results pages when the active todo is still unresolved', () => {
    const resultsPlan = reduceSessionPlan(createSessionPlan('find a good deal on mens socks'), {
      type: 'observation',
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult({
        axTreeText: [
          '- heading "Results" [ref=e1]',
          '- generic "Best Seller Mens Socks Add to cart" [ref=e2] clickable',
        ].join('\n'),
      }),
      stepIndex: 1,
      timestamp: '2026-04-08T00:00:00.000Z',
      url: 'https://www.amazon.com/s?k=mens+socks',
    });

    const reason = shouldBlockFinishSuccess({
      goal: 'find a good deal on mens socks',
      message: 'Found several results for mens socks. I will examine the listed products.',
      observation: makeObservationResult({
        axTreeText: [
          '- heading "Results" [ref=e1]',
          '- generic "Best Seller Mens Socks Add to cart" [ref=e2] clickable',
        ].join('\n'),
      }),
      plan: resultsPlan,
    });

    expect(reason).toContain('active todo');
    expect(reason).toContain('results page');
  });

  it('adds and expires avoided refs on a bounded cooldown', () => {
    const plan = createSessionPlan('find mens socks');
    const cooled = addAvoidRef(
      plan,
      'e6',
      'Repeated clicks produced no visible change.',
      4,
      '2026-04-08T00:00:06.000Z',
      3,
    );

    expect(findActiveAvoidRef(cooled, 'e6', 4)).toMatchObject({
      expiresAfterStep: 7,
      reason: 'Repeated clicks produced no visible change.',
      ref: 'e6',
    });
    expect(findActiveAvoidRef(cooled, 'e6', 7)).toBeNull();
  });
});
