import type { Bounds, ToolName } from '../../../types/agent';
import type { RetryDirective, ValidationResult, ValidationSnapshot } from './types';

// ---------------------------------------------------------------------------
// Fallback chain definitions
// ---------------------------------------------------------------------------

type FallbackEntry = {
  action: ToolName;
  deriveParams: (
    originalParams: Record<string, unknown>,
    snapshot: ValidationSnapshot,
  ) => Record<string, unknown> | null;
};

/**
 * Per-tool ordered fallback chains. Each entry is tried once in sequence after
 * a no_op outcome. A null return from deriveParams means the fallback cannot
 * be computed (e.g. missing bounds) and is skipped.
 */
const FALLBACK_CHAINS: Partial<Record<ToolName, FallbackEntry[]>> = {
  click: [
    {
      action: 'tap_coordinates',
      deriveParams: (original, snapshot) => {
        const targetId =
          typeof original.id === 'string' ? original.id : null;
        if (!targetId) return null;

        const bounds = snapshot.axNodeBounds.get(targetId);
        if (!bounds) return null;

        return {
          x: Math.round(bounds.x + bounds.width / 2),
          y: Math.round(bounds.y + bounds.height / 2),
        };
      },
    },
  ],
  type: [
    {
      // Retry the same action once — the injected JS already has an internal
      // keyboard-event fallback path that may succeed on a second attempt
      // after focus has settled.
      action: 'type',
      deriveParams: (original) => ({ ...original }),
    },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determines whether a failed action should be retried with a fallback.
 *
 * @param attemptIndex 0-based index into the fallback chain (0 = first
 *   fallback, i.e. the original action already failed once).
 */
export function getRetryDirective(
  action: ToolName,
  params: Record<string, unknown>,
  validation: ValidationResult,
  attemptIndex: number,
  snapshot: ValidationSnapshot,
): RetryDirective {
  // Only retry on no_op — everything else either succeeded, is a stale ref
  // (needs re-observation), or is unrecoverable.
  if (validation.outcome !== 'no_op') {
    return { retry: false };
  }

  const chain = FALLBACK_CHAINS[action];
  if (!chain || attemptIndex >= chain.length) {
    return { retry: false };
  }

  const entry = chain[attemptIndex];
  const fallbackParams = entry.deriveParams(params, snapshot);

  if (!fallbackParams) {
    return { retry: false };
  }

  return {
    retry: true,
    fallbackAction: entry.action,
    fallbackParams,
  };
}

/**
 * Returns the center point of a bounding box, useful for coordinate-based
 * fallbacks.
 */
export function boundsCenter(bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
}
