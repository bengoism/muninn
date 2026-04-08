import type {
  InferenceFailure,
  InferenceResponse,
  PlanningContextDebugRequest,
} from '../../../types/agent';

export function shouldRetryInferenceWithoutPlanningContext(
  response: InferenceResponse,
  planningContextSent: boolean,
): response is InferenceFailure {
  return planningContextSent && !response.ok;
}

export function downgradePlanningContextRequest(
  request: PlanningContextDebugRequest | null,
  disabledReason: string | null,
): PlanningContextDebugRequest | null {
  if (!request || !disabledReason) {
    return request;
  }

  if (request.source === 'planning') {
    return null;
  }

  if (request.source === 'planning_and_debug_raw') {
    return {
      ...request,
      reasons: [],
      source: 'debug_raw',
      summary: `Planning inference context disabled: ${disabledReason}. Raw capture is still enabled.`,
    };
  }

  return request;
}
