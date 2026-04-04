import type { AgentActionRecord } from '../../../../types/agent';
import type { ValidationResult } from '../types';
import { diagnoseStuckState } from '../stuck-recovery';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  overrides: Partial<AgentActionRecord> = {},
): AgentActionRecord {
  return {
    action: 'click',
    parameters: { id: 'btn-1' },
    status: 'failed',
    reason: 'Click had no effect',
    urlBefore: 'https://example.com',
    urlAfter: 'https://example.com',
    timestamp: new Date().toISOString(),
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
    reason: null,
    ...overrides,
  };
}

const DEFAULT_CONFIG = { maxConsecutiveNoOps: 3 };

// ---------------------------------------------------------------------------
// Not stuck
// ---------------------------------------------------------------------------

describe('diagnoseStuckState — not stuck', () => {
  it('returns not stuck with empty history', () => {
    const result = diagnoseStuckState([], makeValidation(), 0, 0, DEFAULT_CONFIG);
    expect(result.stuck).toBe(false);
  });

  it('returns not stuck with successful recent actions', () => {
    const history = [
      makeRecord({ status: 'succeeded' }),
      makeRecord({ status: 'succeeded', action: 'type', parameters: { id: 'input', text: 'hi' } }),
    ];
    const result = diagnoseStuckState(history, makeValidation({ outcome: 'success' }), 0, 0, DEFAULT_CONFIG);
    expect(result.stuck).toBe(false);
  });

  it('returns not stuck with consecutive no-ops below threshold', () => {
    const result = diagnoseStuckState(
      [makeRecord()],
      makeValidation(),
      2, // below 3
      0,
      DEFAULT_CONFIG,
    );
    expect(result.stuck).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Repeated identical failure
// ---------------------------------------------------------------------------

describe('diagnoseStuckState — repeated identical failure', () => {
  it('detects two identical failed actions', () => {
    const history = [
      makeRecord({ action: 'click', parameters: { id: 'btn-1' }, status: 'failed' }),
      makeRecord({ action: 'click', parameters: { id: 'btn-1' }, status: 'failed' }),
    ];
    const result = diagnoseStuckState(history, makeValidation(), 0, 0, DEFAULT_CONFIG);
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('repeated_identical_failure');
    expect(result.recovery).toBe('reobserve');
  });

  it('escalates to stop after multiple reobserves', () => {
    const history = [
      makeRecord({ action: 'click', parameters: { id: 'btn-1' }, status: 'no_op' }),
      makeRecord({ action: 'click', parameters: { id: 'btn-1' }, status: 'no_op' }),
    ];
    const result = diagnoseStuckState(history, makeValidation(), 0, 2, DEFAULT_CONFIG);
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('repeated_identical_failure');
    expect(result.recovery).toBe('stop');
  });

  it('does not trigger for different actions', () => {
    const history = [
      makeRecord({ action: 'click', parameters: { id: 'btn-1' }, status: 'failed' }),
      makeRecord({ action: 'click', parameters: { id: 'btn-2' }, status: 'failed' }),
    ];
    const result = diagnoseStuckState(history, makeValidation(), 0, 0, DEFAULT_CONFIG);
    // Different parameters → not identical
    expect(result.stuck).toBe(false);
  });

  it('does not trigger when one action succeeded', () => {
    const history = [
      makeRecord({ action: 'click', parameters: { id: 'btn-1' }, status: 'succeeded' }),
      makeRecord({ action: 'click', parameters: { id: 'btn-1' }, status: 'failed' }),
    ];
    const result = diagnoseStuckState(history, makeValidation(), 0, 0, DEFAULT_CONFIG);
    expect(result.stuck).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Consecutive no-ops at threshold
// ---------------------------------------------------------------------------

describe('diagnoseStuckState — consecutive no-ops', () => {
  it('triggers reobserve at threshold', () => {
    const result = diagnoseStuckState(
      [makeRecord()],
      makeValidation(),
      3, // at threshold
      0,
      DEFAULT_CONFIG,
    );
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('consecutive_no_ops');
    expect(result.recovery).toBe('reobserve');
  });

  it('triggers stop after repeated reobserves', () => {
    const result = diagnoseStuckState(
      [makeRecord()],
      makeValidation(),
      3,
      2, // already tried reobserving twice
      DEFAULT_CONFIG,
    );
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('consecutive_no_ops');
    expect(result.recovery).toBe('stop');
  });
});

// ---------------------------------------------------------------------------
// Modal blocked
// ---------------------------------------------------------------------------

describe('diagnoseStuckState — modal blocked', () => {
  it('detects blocked outcome and recovers with go_back', () => {
    const result = diagnoseStuckState(
      [makeRecord()],
      makeValidation({ outcome: 'blocked' }),
      0,
      0,
      DEFAULT_CONFIG,
    );
    expect(result.stuck).toBe(true);
    expect(result.reason).toBe('modal_blocked');
    expect(result.recovery).toBe('go_back');
  });
});
