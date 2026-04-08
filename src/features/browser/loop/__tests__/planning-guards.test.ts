import type {
  AgentActionRecord,
  SessionPlan,
} from '../../../../types/agent';
import type { ValidationSnapshot } from '../../tools/types';
import {
  hasRepeatedNoOpOnTarget,
  shouldGuardSearchboxTarget,
} from '../planning-guards';
import { createSessionPlan } from '../planning';

function makeRecord(
  overrides: Partial<AgentActionRecord> = {},
): AgentActionRecord {
  return {
    action: 'click',
    parameters: { id: 'e6' },
    reason: 'Click had no effect',
    status: 'no_op',
    timestamp: new Date().toISOString(),
    urlAfter: 'https://example.com',
    urlBefore: 'https://example.com',
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ValidationSnapshot> = {},
): ValidationSnapshot {
  return {
    activeShortRef: null,
    axNodeBounds: new Map(),
    axNodeCount: 1,
    axNodeIds: new Set(['dom-search']),
    axNodeRoles: new Map([['dom-search', 'searchbox']]),
    focusedElementId: null,
    hasDialog: false,
    isLoading: false,
    knownRefIds: new Set(['e6']),
    liveRefIds: new Set(['e6']),
    refToDomId: new Map([['e6', 'dom-search']]),
    scrollY: 0,
    timestamp: Date.now(),
    url: 'https://example.com',
    ...overrides,
  };
}

function makePlan(
  overrides: Partial<SessionPlan> = {},
): SessionPlan {
  return {
    ...createSessionPlan('find mens socks', '2026-04-08T00:00:00.000Z'),
    phase: 'results',
    activeItemId: 'todo-results',
    items: [
      {
        id: 'todo-start',
        text: 'Search or navigate toward: find mens socks',
        status: 'completed',
        source: 'system',
        evidence: 'Reached a results-like page.',
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:01.000Z',
      },
      {
        id: 'todo-results',
        text: 'Open a relevant result for: find mens socks',
        status: 'in_progress',
        source: 'system',
        evidence: null,
        createdAt: '2026-04-08T00:00:01.000Z',
        updatedAt: '2026-04-08T00:00:01.000Z',
      },
    ],
    updatedAt: '2026-04-08T00:00:01.000Z',
    ...overrides,
  };
}

describe('hasRepeatedNoOpOnTarget', () => {
  it('returns true for consecutive matching no-ops at the end of history', () => {
    const history = [
      makeRecord({ parameters: { id: 'e6' } }),
      makeRecord({ parameters: { id: 'e6' } }),
    ];

    expect(hasRepeatedNoOpOnTarget(history, 'click', 'e6')).toBe(true);
  });

  it('returns false when a different action breaks the recent streak', () => {
    const history = [
      makeRecord({ parameters: { id: 'e6' } }),
      makeRecord({
        action: 'click',
        parameters: { id: 'e18' },
        status: 'succeeded',
      }),
      makeRecord({ parameters: { id: 'e6' } }),
    ];

    expect(hasRepeatedNoOpOnTarget(history, 'click', 'e6')).toBe(false);
  });
});

describe('shouldGuardSearchboxTarget', () => {
  it('guards searchbox clicks on results pages when a later todo is active', () => {
    expect(
      shouldGuardSearchboxTarget(makePlan(), makeSnapshot(), 'e6', 'click'),
    ).toBe(true);
  });

  it('does not guard searchbox clicks while the start todo is still active', () => {
    expect(
      shouldGuardSearchboxTarget(
        makePlan({ activeItemId: 'todo-start' }),
        makeSnapshot(),
        'e6',
        'click',
      ),
    ).toBe(false);
  });

  it('does not guard non-searchbox targets', () => {
    expect(
      shouldGuardSearchboxTarget(
        makePlan(),
        makeSnapshot({
          axNodeRoles: new Map([['dom-search', 'button']]),
        }),
        'e6',
        'click',
      ),
    ).toBe(false);
  });
});
