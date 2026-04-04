import type { AgentActionRecord, StopReason } from '../../../types/agent';
import type { ValidationResult } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StuckDiagnosis = {
  stuck: boolean;
  reason: StopReason | null;
  recovery: 'reobserve' | 'go_back' | 'stop';
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Examines recent action history and the latest validation result to decide
 * whether the loop is stuck and what recovery strategy to use.
 *
 * @param reobservesSinceLastProgress How many times the loop has already
 *   chosen to re-observe without making progress. Used to escalate from
 *   re-observation to a hard stop.
 */
export function diagnoseStuckState(
  actionHistory: AgentActionRecord[],
  currentValidation: ValidationResult,
  consecutiveNoOps: number,
  reobservesSinceLastProgress: number,
  config: { maxConsecutiveNoOps: number },
): StuckDiagnosis {
  // 1. Modal / overlay blocker.
  if (currentValidation.outcome === 'blocked') {
    return {
      stuck: true,
      reason: 'modal_blocked',
      recovery: 'go_back',
    };
  }

  // 2. Repeated identical failure: last 2 records have the same action,
  //    same parameters, and both failed-ish.
  if (hasRepeatedIdenticalFailure(actionHistory)) {
    // If we've already tried re-observing, stop.
    if (reobservesSinceLastProgress >= 2) {
      return {
        stuck: true,
        reason: 'repeated_identical_failure',
        recovery: 'stop',
      };
    }
    return {
      stuck: true,
      reason: 'repeated_identical_failure',
      recovery: 'reobserve',
    };
  }

  // 3. Consecutive no-ops at threshold.
  if (consecutiveNoOps >= config.maxConsecutiveNoOps) {
    if (reobservesSinceLastProgress >= 2) {
      return {
        stuck: true,
        reason: 'consecutive_no_ops',
        recovery: 'stop',
      };
    }
    return {
      stuck: true,
      reason: 'consecutive_no_ops',
      recovery: 'reobserve',
    };
  }

  return { stuck: false, reason: null, recovery: 'reobserve' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAILURE_STATUSES = new Set([
  'failed',
  'no_op',
  'blocked',
  'stale_ref',
]);

function hasRepeatedIdenticalFailure(
  history: AgentActionRecord[],
): boolean {
  if (history.length < 2) return false;

  const last = history[history.length - 1];
  const prev = history[history.length - 2];

  if (!FAILURE_STATUSES.has(last.status) || !FAILURE_STATUSES.has(prev.status)) {
    return false;
  }

  if (last.action !== prev.action) return false;

  // Shallow comparison of parameters.
  const lastKeys = Object.keys(last.parameters).sort();
  const prevKeys = Object.keys(prev.parameters).sort();
  if (lastKeys.length !== prevKeys.length) return false;

  for (let i = 0; i < lastKeys.length; i++) {
    if (lastKeys[i] !== prevKeys[i]) return false;
    if (last.parameters[lastKeys[i]] !== prev.parameters[prevKeys[i]]) {
      return false;
    }
  }

  return true;
}
