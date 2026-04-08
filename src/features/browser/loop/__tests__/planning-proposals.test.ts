import type {
  ObservationResult,
  SessionPlan,
} from '../../../../types/agent';
import {
  applyPlanUpdateProposals,
  createSessionPlan,
  reduceSessionPlan,
} from '../planning';

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

function makeResultsObservation(): ObservationResult {
  return makeObservationResult({
    axTreeText: [
      '- heading "Results" [ref=e1]',
      '- generic "Mens socks result one" [ref=e2]',
      '- generic "Mens socks result two" [ref=e3]',
      '- generic "Mens socks result three" [ref=e4]',
      '- generic "Mens socks result four" [ref=e5]',
      '- generic "Mens socks result five" [ref=e6]',
    ].join('\n'),
    debug: {
      combinedRefMap: {
        e1: { domId: 'heading', label: 'Results', role: 'heading', selector: 'h2' },
        e2: { domId: 'r1', label: 'Mens socks result one', role: 'generic', selector: 'div' },
        e3: { domId: 'r2', label: 'Mens socks result two', role: 'generic', selector: 'div' },
        e4: { domId: 'r3', label: 'Mens socks result three', role: 'generic', selector: 'div' },
        e5: { domId: 'r4', label: 'Mens socks result four', role: 'generic', selector: 'div' },
        e6: { domId: 'r5', label: 'Mens socks result five', role: 'generic', selector: 'div' },
      },
      expectedFrameIds: [],
      frameArtifacts: [],
      timedOut: false,
    },
  });
}

function findItem(plan: SessionPlan, id: string) {
  return plan.items.find((item) => item.id === id);
}

describe('applyPlanUpdateProposals', () => {
  it('accepts add_item and can activate the created todo', () => {
    const result = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeObservationResult(),
      plan: createSessionPlan('find mens socks', '2026-04-08T00:00:00.000Z'),
      proposals: [
        {
          type: 'add_item',
          text: 'Inspect shipping cost and seller details',
          activate: true,
        },
      ],
      timestamp: '2026-04-08T00:00:01.000Z',
      url: 'https://www.amazon.com',
    });

    expect(result.decisions[0]).toMatchObject({
      accepted: true,
      proposal: {
        type: 'add_item',
      },
    });
    expect(result.decisions[0]?.createdItemId).toBeTruthy();
    expect(result.plan.activeItemId).toBe(result.decisions[0]?.createdItemId);
    expect(findItem(result.plan, result.decisions[0]!.createdItemId!)).toMatchObject({
      source: 'model',
      status: 'in_progress',
      text: 'Inspect shipping cost and seller details',
    });
  });

  it('rejects duplicate add_item proposals', () => {
    const first = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeObservationResult(),
      plan: createSessionPlan('find mens socks', '2026-04-08T00:00:00.000Z'),
      proposals: [
        {
          type: 'add_item',
          text: 'Inspect shipping cost and seller details',
        },
      ],
      timestamp: '2026-04-08T00:00:01.000Z',
      url: 'https://www.amazon.com',
    });

    const second = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeObservationResult(),
      plan: first.plan,
      proposals: [
        {
          type: 'add_item',
          text: 'Inspect shipping cost and seller details',
        },
      ],
      timestamp: '2026-04-08T00:00:02.000Z',
      url: 'https://www.amazon.com',
    });

    expect(second.decisions[0]).toMatchObject({
      accepted: false,
    });
    expect(second.decisions[0]?.reason).toContain('already present');
  });

  it('accepts set_phase when the observation supports that phase', () => {
    const result = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeResultsObservation(),
      plan: createSessionPlan('find mens socks', '2026-04-08T00:00:00.000Z'),
      proposals: [
        {
          type: 'set_phase',
          phase: 'results',
          evidence: 'Search results are visible.',
        },
      ],
      timestamp: '2026-04-08T00:00:01.000Z',
      url: 'https://www.amazon.com/s?k=mens+socks',
    });

    expect(result.decisions[0]).toMatchObject({ accepted: true });
    expect(result.plan.phase).toBe('results');
    expect(result.plan.activeItemId).toBe('todo-results');
  });

  it('rejects set_phase done before verified completion', () => {
    const result = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeResultsObservation(),
      plan: createSessionPlan('find mens socks', '2026-04-08T00:00:00.000Z'),
      proposals: [{ type: 'set_phase', phase: 'done' }],
      timestamp: '2026-04-08T00:00:01.000Z',
      url: 'https://www.amazon.com/s?k=mens+socks',
    });

    expect(result.decisions[0]).toMatchObject({ accepted: false });
    expect(result.plan.phase).toBe('initial');
  });

  it('accepts completing todo-start once the current page is clearly results-like', () => {
    const result = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeResultsObservation(),
      plan: createSessionPlan('find mens socks', '2026-04-08T00:00:00.000Z'),
      proposals: [{ type: 'complete_item', id: 'todo-start' }],
      timestamp: '2026-04-08T00:00:01.000Z',
      url: 'https://www.amazon.com/s?k=mens+socks',
    });

    expect(result.decisions[0]).toMatchObject({ accepted: true });
    expect(findItem(result.plan, 'todo-start')).toMatchObject({
      status: 'completed',
    });
  });

  it('rejects completing todo-results while still on a results page', () => {
    const resultsPlan = reduceSessionPlan(createSessionPlan('find mens socks'), {
      type: 'observation',
      goal: 'find mens socks',
      observation: makeResultsObservation(),
      stepIndex: 1,
      timestamp: '2026-04-08T00:00:00.000Z',
      url: 'https://www.amazon.com/s?k=mens+socks',
    });

    const result = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeResultsObservation(),
      plan: resultsPlan,
      proposals: [{ type: 'complete_item', id: 'todo-results' }],
      timestamp: '2026-04-08T00:00:01.000Z',
      url: 'https://www.amazon.com/s?k=mens+socks',
    });

    expect(result.decisions[0]).toMatchObject({ accepted: false });
    expect(findItem(result.plan, 'todo-results')).toMatchObject({
      status: 'in_progress',
    });
  });

  it('allows dropping model-added todos but not runtime-owned todos', () => {
    const withModelTodo = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeObservationResult(),
      plan: createSessionPlan('find mens socks', '2026-04-08T00:00:00.000Z'),
      proposals: [{ type: 'add_item', text: 'Compare shipping speeds' }],
      timestamp: '2026-04-08T00:00:01.000Z',
      url: 'https://www.amazon.com',
    });

    const modelItemId = withModelTodo.decisions[0]?.createdItemId ?? null;
    expect(modelItemId).toBeTruthy();

    const dropped = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeObservationResult(),
      plan: withModelTodo.plan,
      proposals: [{ type: 'drop_item', id: modelItemId!, reason: 'Not needed anymore.' }],
      timestamp: '2026-04-08T00:00:02.000Z',
      url: 'https://www.amazon.com',
    });

    expect(dropped.decisions[0]).toMatchObject({ accepted: true });
    expect(findItem(dropped.plan, modelItemId!)).toMatchObject({
      status: 'dropped',
    });

    const rejected = applyPlanUpdateProposals({
      actionHistory: [],
      goal: 'find mens socks',
      observation: makeObservationResult(),
      plan: withModelTodo.plan,
      proposals: [{ type: 'drop_item', id: 'todo-start', reason: 'Skip it.' }],
      timestamp: '2026-04-08T00:00:03.000Z',
      url: 'https://www.amazon.com',
    });

    expect(rejected.decisions[0]).toMatchObject({ accepted: false });
    expect(findItem(rejected.plan, 'todo-start')).toMatchObject({
      status: 'in_progress',
    });
  });
});
