import type { ValidationResult, ValidationSnapshot } from '../types';
import { getRetryDirective } from '../retry-policy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(
  overrides: Partial<ValidationSnapshot> = {},
): ValidationSnapshot {
  return {
    url: 'https://example.com',
    isLoading: false,
    scrollY: 0,
    axNodeIds: new Set(['btn-1', 'input-2']),
    axNodeBounds: new Map([
      ['btn-1', { x: 10, y: 20, width: 100, height: 40 }],
      ['input-2', { x: 10, y: 80, width: 200, height: 30 }],
    ]),
    axNodeCount: 2,
    focusedElementId: null,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeValidation(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    outcome: 'no_op',
    signals: {
      urlChanged: false,
      loadingChanged: false,
      scrollChanged: false,
      axDelta: { added: 0, removed: 0, total: 0 },
      targetStillPresent: true,
      focusChanged: false,
    },
    reason: 'Click executed but no observable state change.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// click fallback
// ---------------------------------------------------------------------------

describe('getRetryDirective — click', () => {
  it('returns tap_coordinates fallback on no_op with attempt 0', () => {
    const snapshot = makeSnapshot();
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation(),
      0,
      snapshot,
    );
    expect(directive.retry).toBe(true);
    if (directive.retry) {
      expect(directive.fallbackAction).toBe('tap_coordinates');
      expect(directive.fallbackParams).toEqual({ x: 60, y: 40 }); // center of 10,20,100,40
    }
  });

  it('returns no retry on no_op with attempt 1 (chain exhausted)', () => {
    const snapshot = makeSnapshot();
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation(),
      1,
      snapshot,
    );
    expect(directive.retry).toBe(false);
  });

  it('returns no retry when target bounds are missing', () => {
    const snapshot = makeSnapshot({
      axNodeBounds: new Map(), // no bounds
    });
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation(),
      0,
      snapshot,
    );
    expect(directive.retry).toBe(false);
  });

  it('returns no retry on success outcome', () => {
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation({ outcome: 'success' }),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });

  it('returns no retry on stale_ref outcome', () => {
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation({ outcome: 'stale_ref' }),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });

  it('returns no retry on blocked outcome', () => {
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation({ outcome: 'blocked' }),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });

  it('returns no retry on unrecoverable outcome', () => {
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation({ outcome: 'unrecoverable' }),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// type fallback
// ---------------------------------------------------------------------------

describe('getRetryDirective — type', () => {
  it('retries same action on no_op with attempt 0', () => {
    const directive = getRetryDirective(
      'type',
      { id: 'input-2', text: 'hello' },
      makeValidation(),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(true);
    if (directive.retry) {
      expect(directive.fallbackAction).toBe('type');
      expect(directive.fallbackParams).toEqual({ id: 'input-2', text: 'hello' });
    }
  });

  it('returns no retry on attempt 1', () => {
    const directive = getRetryDirective(
      'type',
      { id: 'input-2', text: 'hello' },
      makeValidation(),
      1,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scroll — no fallback
// ---------------------------------------------------------------------------

describe('getRetryDirective — scroll', () => {
  it('returns no retry even on no_op', () => {
    const directive = getRetryDirective(
      'scroll',
      { direction: 'down', amount: 'page' },
      makeValidation(),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// go_back — no fallback
// ---------------------------------------------------------------------------

describe('getRetryDirective — go_back', () => {
  it('returns no retry even on no_op', () => {
    const directive = getRetryDirective(
      'go_back',
      {},
      makeValidation(),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// partial_success — no retry
// ---------------------------------------------------------------------------

describe('getRetryDirective — partial_success', () => {
  it('returns no retry on partial_success for any tool', () => {
    const directive = getRetryDirective(
      'click',
      { id: 'btn-1' },
      makeValidation({ outcome: 'partial_success' }),
      0,
      makeSnapshot(),
    );
    expect(directive.retry).toBe(false);
  });
});
