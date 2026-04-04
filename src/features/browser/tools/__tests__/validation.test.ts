import type { ToolResult, ValidationSnapshot } from '../types';
import { classifyOutcome, isStaleRef } from '../validation';

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
    axNodeIds: new Set(['btn-1', 'input-2', 'link-3']),
    axNodeBounds: new Map([
      ['btn-1', { x: 10, y: 20, width: 100, height: 40 }],
      ['input-2', { x: 10, y: 80, width: 200, height: 30 }],
      ['link-3', { x: 10, y: 130, width: 150, height: 20 }],
    ]),
    axNodeRoles: new Map(),
    axNodeCount: 3,
    focusedElementId: null,
    hasDialog: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    ok: true,
    action: 'click',
    reason: null,
    durationMs: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isStaleRef
// ---------------------------------------------------------------------------

describe('isStaleRef', () => {
  it('returns true when element ID is absent from snapshot', () => {
    const snapshot = makeSnapshot();
    expect(isStaleRef('nonexistent', snapshot)).toBe(true);
  });

  it('returns false when element ID is present', () => {
    const snapshot = makeSnapshot();
    expect(isStaleRef('btn-1', snapshot)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome — click
// ---------------------------------------------------------------------------

describe('classifyOutcome — click', () => {
  it('returns success when URL changed after click', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({ url: 'https://example.com/page2' });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('success');
    expect(result.signals.urlChanged).toBe(true);
  });

  it('returns success when AX delta exceeds threshold', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      axNodeIds: new Set(['btn-1', 'input-2', 'link-3', 'new-1', 'new-2', 'new-3']),
      axNodeCount: 6,
    });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('success');
    expect(result.signals.axDelta.added).toBe(3);
  });

  it('returns success when focus changed', () => {
    const before = makeSnapshot({ focusedElementId: null });
    const after = makeSnapshot({ focusedElementId: 'input-2' });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('success');
    expect(result.signals.focusChanged).toBe(true);
  });

  it('returns no_op when nothing changed', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('no_op');
  });

  it('returns stale_ref when target element disappeared', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      axNodeIds: new Set(['input-2', 'link-3']),
      axNodeCount: 2,
    });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('stale_ref');
    expect(result.signals.targetStillPresent).toBe(false);
  });

  it('returns stale_ref when executor fails for an ID not in the DOM', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    const toolResult = makeToolResult({ ok: false, reason: 'Element not found: btn-99' });
    const result = classifyOutcome('click', { id: 'btn-99' }, toolResult, before, after);
    expect(result.outcome).toBe('stale_ref');
  });

  it('returns unrecoverable when executor fails but target was present', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    // btn-1 is in the snapshot, so not a stale ref — executor failure is unrecoverable
    const toolResult = makeToolResult({ ok: false, reason: 'JS evaluation error' });
    const result = classifyOutcome('click', { id: 'btn-1' }, toolResult, before, after);
    expect(result.outcome).toBe('unrecoverable');
  });

  it('returns stale_ref when executor fails and target was already gone', () => {
    const before = makeSnapshot({ axNodeIds: new Set(['input-2']), axNodeCount: 1 });
    const after = makeSnapshot({ axNodeIds: new Set(['input-2']), axNodeCount: 1 });
    const toolResult = makeToolResult({ ok: false, reason: 'Element not found' });
    const result = classifyOutcome('click', { id: 'btn-1' }, toolResult, before, after);
    expect(result.outcome).toBe('stale_ref');
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome — tap_coordinates
// ---------------------------------------------------------------------------

describe('classifyOutcome — tap_coordinates', () => {
  it('returns success when URL changed', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({ url: 'https://example.com/new' });
    const result = classifyOutcome(
      'tap_coordinates',
      { x: 50, y: 40 },
      makeToolResult({ action: 'tap_coordinates' }),
      before,
      after,
    );
    expect(result.outcome).toBe('success');
  });

  it('returns no_op when nothing changed', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    const result = classifyOutcome(
      'tap_coordinates',
      { x: 50, y: 40 },
      makeToolResult({ action: 'tap_coordinates' }),
      before,
      after,
    );
    expect(result.outcome).toBe('no_op');
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome — type
// ---------------------------------------------------------------------------

describe('classifyOutcome — type', () => {
  it('returns success when focus changed', () => {
    const before = makeSnapshot({ focusedElementId: null });
    const after = makeSnapshot({ focusedElementId: 'input-2' });
    const result = classifyOutcome(
      'type',
      { id: 'input-2', text: 'hello' },
      makeToolResult({ action: 'type' }),
      before,
      after,
    );
    expect(result.outcome).toBe('success');
  });

  it('returns success when AX nodes changed', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      axNodeIds: new Set(['btn-1', 'input-2', 'link-3', 'suggestion-1']),
      axNodeCount: 4,
    });
    const result = classifyOutcome(
      'type',
      { id: 'input-2', text: 'hello' },
      makeToolResult({ action: 'type' }),
      before,
      after,
    );
    expect(result.outcome).toBe('success');
  });

  it('returns no_op when nothing changed', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    const result = classifyOutcome(
      'type',
      { id: 'input-2', text: 'hello' },
      makeToolResult({ action: 'type' }),
      before,
      after,
    );
    expect(result.outcome).toBe('no_op');
  });

  it('returns stale_ref when target element is gone', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      axNodeIds: new Set(['btn-1', 'link-3']),
      axNodeCount: 2,
    });
    const result = classifyOutcome(
      'type',
      { id: 'input-2', text: 'hello' },
      makeToolResult({ action: 'type' }),
      before,
      after,
    );
    expect(result.outcome).toBe('stale_ref');
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome — scroll
// ---------------------------------------------------------------------------

describe('classifyOutcome — scroll', () => {
  it('returns success when scrollY changed', () => {
    const before = makeSnapshot({ scrollY: 0 });
    const after = makeSnapshot({ scrollY: 600 });
    const result = classifyOutcome(
      'scroll',
      { direction: 'down', amount: 'page' },
      makeToolResult({ action: 'scroll' }),
      before,
      after,
    );
    expect(result.outcome).toBe('success');
    expect(result.signals.scrollChanged).toBe(true);
  });

  it('returns no_op when scrollY did not change (boundary)', () => {
    const before = makeSnapshot({ scrollY: 0 });
    const after = makeSnapshot({ scrollY: 0 });
    const result = classifyOutcome(
      'scroll',
      { direction: 'up', amount: 'page' },
      makeToolResult({ action: 'scroll' }),
      before,
      after,
    );
    expect(result.outcome).toBe('no_op');
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome — go_back
// ---------------------------------------------------------------------------

describe('classifyOutcome — go_back', () => {
  it('returns success when URL changed', () => {
    const before = makeSnapshot({ url: 'https://example.com/page2' });
    const after = makeSnapshot({ url: 'https://example.com' });
    const result = classifyOutcome(
      'go_back',
      {},
      makeToolResult({ action: 'go_back' }),
      before,
      after,
    );
    expect(result.outcome).toBe('success');
  });

  it('returns no_op when URL did not change', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    const result = classifyOutcome(
      'go_back',
      {},
      makeToolResult({ action: 'go_back' }),
      before,
      after,
    );
    expect(result.outcome).toBe('no_op');
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome — non-browser actions
// ---------------------------------------------------------------------------

describe('classifyOutcome — wait', () => {
  it('returns success for wait action', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    const result = classifyOutcome(
      'wait',
      {},
      makeToolResult({ action: 'wait' }),
      before,
      after,
    );
    expect(result.outcome).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome — dialog/overlay detection
// ---------------------------------------------------------------------------

describe('classifyOutcome — dialog detection', () => {
  it('returns blocked when hasDialog transitions from false to true', () => {
    const before = makeSnapshot({ hasDialog: false });
    const after = makeSnapshot({ hasDialog: true });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('blocked');
  });

  it('returns blocked when a new node with role=dialog appears', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      axNodeIds: new Set(['btn-1', 'input-2', 'link-3', 'dialog-1']),
      axNodeRoles: new Map([['dialog-1', 'dialog']]),
      axNodeCount: 4,
    });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('blocked');
  });

  it('returns blocked when a new node with role=alertdialog appears', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      axNodeIds: new Set(['btn-1', 'input-2', 'link-3', 'alert-1']),
      axNodeRoles: new Map([['alert-1', 'alertdialog']]),
      axNodeCount: 4,
    });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).toBe('blocked');
  });

  it('does not return blocked when dialog was already present before action', () => {
    const before = makeSnapshot({ hasDialog: true });
    const after = makeSnapshot({ hasDialog: true });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).not.toBe('blocked');
  });

  it('does not return blocked when new nodes have non-dialog roles', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      axNodeIds: new Set(['btn-1', 'input-2', 'link-3', 'new-btn']),
      axNodeRoles: new Map([['new-btn', 'button']]),
      axNodeCount: 4,
    });
    const result = classifyOutcome('click', { id: 'btn-1' }, makeToolResult(), before, after);
    expect(result.outcome).not.toBe('blocked');
  });
});
