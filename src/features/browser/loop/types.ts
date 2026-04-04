import type { InferenceResponse, ObservationResult } from '../../../types/agent';
import type { ToolResult } from '../tools/types';

export type LoopConfig = {
  maxSteps: number;
  maxDurationMs: number;
  maxConsecutiveNoOps: number;
  postActionSettleMs: number;
};

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxSteps: 30,
  maxDurationMs: 0,
  maxConsecutiveNoOps: 3,
  postActionSettleMs: 800,
};

export type StepRecord = {
  stepIndex: number;
  observation: ObservationResult | null;
  inference: InferenceResponse | null;
  toolResult: ToolResult | null;
  startedAt: number;
  endedAt: number | null;
};
