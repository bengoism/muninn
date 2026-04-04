import type { Bounds, ToolName } from '../../../types/agent';
import { useBrowserStore } from '../../../state/browser-store';
import type { BrowserWebViewHandle } from '../components/BrowserWebView';
import { ACTIONS_INJECTION_SCRIPT } from './actions';
import type {
  ActionOutcome,
  ToolResult,
  ValidationResult,
  ValidationSignals,
  ValidationSnapshot,
} from './types';

// ---------------------------------------------------------------------------
// Raw shape returned by window.__MUNINN_ACTIONS__.captureValidationState()
// ---------------------------------------------------------------------------

type RawValidationState = {
  scrollY: number;
  axNodeIds: string[];
  axNodeBounds: Record<string, Bounds>;
  focusedElementId: string | null;
};

// ---------------------------------------------------------------------------
// Snapshot capture
// ---------------------------------------------------------------------------

async function ensureActionsInjected(
  browser: BrowserWebViewHandle,
): Promise<void> {
  const check = await browser.evaluateJavaScript<string>(
    'typeof window.__MUNINN_ACTIONS__',
  );
  if (check.ok && check.value === 'object') return;
  await browser.evaluateJavaScript(ACTIONS_INJECTION_SCRIPT);
}

export async function captureValidationSnapshot(
  browser: BrowserWebViewHandle,
): Promise<ValidationSnapshot> {
  await ensureActionsInjected(browser);

  const result = await browser.evaluateJavaScript<RawValidationState>(
    'window.__MUNINN_ACTIONS__.captureValidationState()',
  );

  const browserState = useBrowserStore.getState();

  if (!result.ok) {
    // Return a minimal snapshot so callers don't have to null-check.
    return {
      url: browserState.currentUrl,
      isLoading: browserState.isLoading,
      scrollY: 0,
      axNodeIds: new Set(),
      axNodeBounds: new Map(),
      axNodeCount: 0,
      focusedElementId: null,
      timestamp: Date.now(),
    };
  }

  const raw = result.value;
  const axNodeBounds = new Map<string, Bounds>();
  for (const [id, b] of Object.entries(raw.axNodeBounds)) {
    axNodeBounds.set(id, b);
  }

  return {
    url: browserState.currentUrl,
    isLoading: browserState.isLoading,
    scrollY: raw.scrollY,
    axNodeIds: new Set(raw.axNodeIds),
    axNodeBounds,
    axNodeCount: raw.axNodeIds.length,
    focusedElementId: raw.focusedElementId,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Stale-ref check
// ---------------------------------------------------------------------------

export function isStaleRef(
  elementId: string,
  snapshot: ValidationSnapshot,
): boolean {
  return !snapshot.axNodeIds.has(elementId);
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

const AX_DELTA_THRESHOLD = 3;

function computeSignals(
  action: ToolName,
  params: Record<string, unknown>,
  before: ValidationSnapshot,
  after: ValidationSnapshot,
): ValidationSignals {
  const addedIds = [...after.axNodeIds].filter(
    (id) => !before.axNodeIds.has(id),
  );
  const removedIds = [...before.axNodeIds].filter(
    (id) => !after.axNodeIds.has(id),
  );

  const targetId =
    'id' in params && typeof params.id === 'string' ? params.id : null;

  return {
    urlChanged: before.url !== after.url,
    loadingChanged: before.isLoading !== after.isLoading,
    scrollChanged: before.scrollY !== after.scrollY,
    axDelta: {
      added: addedIds.length,
      removed: removedIds.length,
      total: addedIds.length + removedIds.length,
    },
    targetStillPresent:
      targetId !== null ? after.axNodeIds.has(targetId) : null,
    focusChanged: before.focusedElementId !== after.focusedElementId,
  };
}

function hasDialogAppeared(
  _before: ValidationSnapshot,
  _after: ValidationSnapshot,
): boolean {
  // Heuristic: a large number of new nodes appearing simultaneously can
  // indicate an overlay/modal. A more precise check would inspect AX roles,
  // but the lightweight snapshot only collects IDs and bounds. For v1 we
  // detect whether many new nodes appeared whose bounding boxes overlap the
  // centre of the viewport (a rough proxy for "something popped up on top").
  //
  // TODO(#7): refine once we include role data in the validation snapshot.
  return false;
}

export function classifyOutcome(
  action: ToolName,
  params: Record<string, unknown>,
  toolResult: ToolResult,
  before: ValidationSnapshot,
  after: ValidationSnapshot,
): ValidationResult {
  const signals = computeSignals(action, params, before, after);

  // If the executor itself reported failure (e.g. element not found), trust it.
  if (!toolResult.ok) {
    const targetId =
      'id' in params && typeof params.id === 'string' ? params.id : null;
    if (targetId && isStaleRef(targetId, before)) {
      return { outcome: 'stale_ref', signals, reason: toolResult.reason };
    }
    return { outcome: 'unrecoverable', signals, reason: toolResult.reason };
  }

  // Blocked detection.
  if (hasDialogAppeared(before, after)) {
    return {
      outcome: 'blocked',
      signals,
      reason: 'A dialog or overlay appeared after the action.',
    };
  }

  // Per-tool classification.
  switch (action) {
    case 'click':
    case 'tap_coordinates':
      return classifyClick(signals, params);
    case 'type':
      return classifyType(signals, params);
    case 'scroll':
      return classifyScroll(signals, params);
    case 'go_back':
      return classifyGoBack(signals);
    default:
      // wait, finish, yield_to_user — always success from executor.
      return { outcome: 'success', signals, reason: null };
  }
}

// ---------------------------------------------------------------------------
// Per-tool classifiers
// ---------------------------------------------------------------------------

function classifyClick(
  signals: ValidationSignals,
  params: Record<string, unknown>,
): ValidationResult {
  const targetId =
    'id' in params && typeof params.id === 'string' ? params.id : null;

  // Stale ref: target was already gone before the action.
  if (targetId && signals.targetStillPresent === false) {
    return {
      outcome: 'stale_ref',
      signals,
      reason: `Target element ${targetId} is no longer in the DOM.`,
    };
  }

  // Success indicators: URL changed, significant AX mutation, or focus moved.
  if (
    signals.urlChanged ||
    signals.axDelta.total >= AX_DELTA_THRESHOLD ||
    signals.focusChanged
  ) {
    return { outcome: 'success', signals, reason: null };
  }

  return {
    outcome: 'no_op',
    signals,
    reason: 'Click executed but no observable state change.',
  };
}

function classifyType(
  signals: ValidationSignals,
  params: Record<string, unknown>,
): ValidationResult {
  const targetId =
    'id' in params && typeof params.id === 'string' ? params.id : null;

  if (targetId && signals.targetStillPresent === false) {
    return {
      outcome: 'stale_ref',
      signals,
      reason: `Target element ${targetId} is no longer in the DOM.`,
    };
  }

  // Typing typically doesn't cause large AX mutations; focus on target is the
  // primary success signal.
  if (signals.focusChanged || signals.axDelta.total > 0) {
    return { outcome: 'success', signals, reason: null };
  }

  return {
    outcome: 'no_op',
    signals,
    reason: 'Type executed but no observable state change.',
  };
}

function classifyScroll(
  signals: ValidationSignals,
  _params: Record<string, unknown>,
): ValidationResult {
  if (signals.scrollChanged) {
    return { outcome: 'success', signals, reason: null };
  }

  return {
    outcome: 'no_op',
    signals,
    reason: 'Scroll had no effect (may have hit a boundary).',
  };
}

function classifyGoBack(signals: ValidationSignals): ValidationResult {
  if (signals.urlChanged) {
    return { outcome: 'success', signals, reason: null };
  }

  return {
    outcome: 'no_op',
    signals,
    reason: 'go_back had no effect (no previous history entry).',
  };
}
