import type { Bounds, ToolName } from '../../../types/agent';

export type ToolParamSchema = Record<
  string,
  { type: 'string' | 'number'; required: boolean }
>;

export type ToolResult = {
  ok: boolean;
  action: ToolName;
  reason: string | null;
  durationMs: number;
};

export type ToolDefinition = {
  name: ToolName;
  params: ToolParamSchema;
  terminal: boolean;
  requiresBrowser: boolean;
};

// ---------------------------------------------------------------------------
// Post-action validation types (issue #7)
// ---------------------------------------------------------------------------

/** Richer outcome classification replacing binary ok/fail. */
export type ActionOutcome =
  | 'success'
  | 'no_op'
  | 'partial_success'
  | 'blocked'
  | 'stale_ref'
  | 'unrecoverable';

/** Lightweight page state captured before and after an action. */
export type ValidationSnapshot = {
  url: string | null;
  isLoading: boolean;
  scrollY: number;
  axNodeIds: Set<string>;
  axNodeBounds: Map<string, Bounds>;
  axNodeCount: number;
  focusedElementId: string | null;
  timestamp: number;
};

export type ValidationSignals = {
  urlChanged: boolean;
  loadingChanged: boolean;
  scrollChanged: boolean;
  axDelta: { added: number; removed: number; total: number };
  targetStillPresent: boolean | null;
  focusChanged: boolean;
};

export type ValidationResult = {
  outcome: ActionOutcome;
  signals: ValidationSignals;
  reason: string | null;
};

export type RetryDirective =
  | { retry: false }
  | {
      retry: true;
      fallbackAction: ToolName;
      fallbackParams: Record<string, unknown>;
    };
