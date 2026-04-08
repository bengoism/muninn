import type {
  Bounds,
  ObservationRefEntry,
  ToolName,
} from '../../../types/agent';

export type ToolParamSchema = Record<
  string,
  { type: 'string' | 'number'; required: boolean }
>;

export type ToolResult = {
  ok: boolean;
  action: ToolName;
  reason: string | null;
  durationMs: number;
  debug?: ToolExecutionDebug | null;
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
  activeShortRef: string | null;
  axNodeBounds: Map<string, Bounds>;
  axNodeRoles: Map<string, string>;
  axNodeCount: number;
  focusedElementId: string | null;
  hasDialog: boolean;
  knownRefIds: Set<string>;
  liveRefIds: Set<string>;
  refToDomId: Map<string, string>;
  timestamp: number;
};

export type ValidationSignals = {
  urlChanged: boolean;
  loadingChanged: boolean;
  scrollChanged: boolean;
  axDelta: { added: number; removed: number; total: number };
  targetStillPresent: boolean | null;
  targetWasKnown: boolean | null;
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

export type TargetReferenceKind = 'short_ref' | 'dom_id' | 'unknown';

export type TargetReferenceState =
  | 'known_ref'
  | 'legacy_dom_id'
  | 'stale_ref'
  | 'unknown_ref';

export type LocatorCandidateSummary = {
  domId: string | null;
  htmlId: string | null;
  label: string | null;
  role: string | null;
  selector: string | null;
  tagName: string | null;
  text: string | null;
};

export type LocatorStrategyTrace = {
  candidateCount: number;
  candidates: LocatorCandidateSummary[];
  matched: boolean;
  matchedCandidate: LocatorCandidateSummary | null;
  reason: string | null;
  strategy: string;
};

export type LocatorResolutionTrace = {
  attempts: LocatorStrategyTrace[];
  matchedCandidate: LocatorCandidateSummary | null;
  refEntry: ObservationRefEntry | null;
  targetId: string;
  targetKind: TargetReferenceKind;
  targetState: TargetReferenceState;
};

export type ToolExecutionDebug = {
  jsCall: string | null;
  matchedElement: LocatorCandidateSummary | null;
  requestedAction: ToolName | 'resolve_only';
  requestedParams: Record<string, unknown>;
  resolver: LocatorResolutionTrace | null;
  targetState: TargetReferenceState | null;
};
