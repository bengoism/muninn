import type {
  ActionOutcome,
  ToolExecutionDebug,
  ValidationSignals,
} from '../tools/types';
import type { ToolName } from '../../../types/agent';

export type ValidationSnapshotSummary = {
  activeShortRef: string | null;
  axNodeCount: number;
  focusedElementId: string | null;
  hasDialog: boolean;
  isLoading: boolean;
  liveRefCount: number;
  scrollY: number;
  url: string | null;
};

export type ActionDebugTrace = {
  action: ToolName;
  executor: {
    debug: ToolExecutionDebug | null;
    durationMs: number;
    ok: boolean;
    reason: string | null;
  } | null;
  inferenceDiagnostics: Record<string, unknown> | null;
  parameters: Record<string, unknown>;
  postSnapshot: ValidationSnapshotSummary | null;
  preSnapshot: ValidationSnapshotSummary | null;
  retry: {
    action: ToolName;
    executor: {
      debug: ToolExecutionDebug | null;
      durationMs: number;
      ok: boolean;
      reason: string | null;
    };
    parameters: Record<string, unknown>;
    validation: {
      outcome: ActionOutcome;
      reason: string | null;
      signals: ValidationSignals;
    };
  } | null;
  step: number;
  targetState: ToolExecutionDebug['targetState'];
  timestamp: string;
  validation: {
    outcome: ActionOutcome;
    reason: string | null;
    signals: ValidationSignals;
  } | null;
};

export type LocatorProbeTrace = {
  debug: ToolExecutionDebug | null;
  ok: boolean;
  reason: string | null;
  targetId: string;
  timestamp: string;
};
