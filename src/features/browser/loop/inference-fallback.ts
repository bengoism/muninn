import type {
  InferenceFailure,
  InferenceRequest,
  InferenceResponse,
  InferenceTargetSummary,
  PlanningContextDebugRequest,
} from '../../../types/agent';

const REDUCED_MAIN_CONTENT_ITEMS = 3;
const REDUCED_EDITABLE_ITEMS = 2;
const REDUCED_EXPLORATORY_ITEMS = 2;
const REDUCED_SECONDARY_ITEMS = 2;
const REDUCED_GLOBAL_ITEMS = 2;

export function shouldRetryInferenceWithoutPlanningContext(
  response: InferenceResponse,
  planningContextSent: boolean,
): response is InferenceFailure {
  return planningContextSent && !response.ok;
}

export function shouldRetryInferenceWithReducedContext(
  response: InferenceResponse,
): response is InferenceFailure {
  if (response.ok || response.code !== 'model_load_failed') {
    return false;
  }

  const message = response.message.toLowerCase();
  if (message.includes('conversation_send_message=null')) {
    return true;
  }

  const details = response.details as Record<string, unknown> | null;
  const adapterUserInfo =
    details?.adapterUserInfo as Record<string, unknown> | undefined;
  const description = String(
    adapterUserInfo?.NSLocalizedDescription ??
      details?.NSLocalizedDescription ??
      '',
  ).toLowerCase();

  return description.includes('conversation_send_message=null');
}

export function canReduceInferenceRequest(
  request: InferenceRequest,
): boolean {
  return (
    request.planningContext !== null ||
    request.targetSummary !== null ||
    request.actionHistory.length > 2 ||
    request.axTreeText.length > 2800
  );
}

export function buildReducedInferenceRequest(
  request: InferenceRequest,
): InferenceRequest {
  return {
    ...request,
    planningContext: null,
    targetSummary: compactTargetSummary(request.targetSummary),
    actionHistory: request.actionHistory.slice(-2),
    axTreeText: truncateTreeText(request.axTreeText, 2800),
  };
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

function truncateTreeText(treeText: string, maxChars: number): string {
  if (treeText.length <= maxChars) {
    return treeText;
  }

  const truncated = treeText.slice(0, Math.max(0, maxChars - 32)).trimEnd();
  return `${truncated}\n... (truncated for fallback)`;
}

function compactTargetSummary(
  summary: InferenceTargetSummary | null,
): InferenceTargetSummary | null {
  if (!summary) {
    return null;
  }

  return {
    editable: summary.editable.slice(0, REDUCED_EDITABLE_ITEMS),
    exploratoryOpeners: summary.exploratoryOpeners.slice(0, REDUCED_EXPLORATORY_ITEMS),
    globalControls: summary.globalControls.slice(0, REDUCED_GLOBAL_ITEMS),
    mainContent: summary.mainContent.slice(0, REDUCED_MAIN_CONTENT_ITEMS),
    secondaryActions: summary.secondaryActions.slice(0, REDUCED_SECONDARY_ITEMS),
  };
}
