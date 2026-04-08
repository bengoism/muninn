import type {
  AgentActionRecord,
  InferencePlanningContext,
  ObservationResult,
  PlanningContextDebugRequest,
  PlanningContextReason,
  SessionPlan,
} from '../../../types/agent';

type PlanningContextDecisionArgs = {
  actionHistory: AgentActionRecord[];
  currentUrl: string | null;
  debugRawEnabled: boolean;
  plan: SessionPlan | null;
  previousObservation: ObservationResult | null;
  previousRequest: PlanningContextDebugRequest | null;
  stepIndex: number;
};

const RICH_CONTEXT_PHASES = new Set(['results', 'detail', 'form', 'checkout']);

export function decidePlanningContextRequest(
  args: PlanningContextDecisionArgs,
): PlanningContextDebugRequest | null {
  const reasons = dedupeReasons([
    getPostNavigationReason(args.actionHistory),
    getRepeatedFailureReason(args.actionHistory),
    getSparseRefsReason(args.plan, args.previousObservation),
    getPlanAmbiguityReason(args.plan, args.actionHistory),
  ]);

  const hasPlanningReason = reasons.length > 0;
  const source = getRequestSource(hasPlanningReason, args.debugRawEnabled);
  if (source === null) {
    return null;
  }

  if (
    hasPlanningReason &&
    args.previousRequest &&
    isDuplicatePlanningRequest(args.previousRequest, reasons, args.currentUrl, args.stepIndex)
  ) {
    if (!args.debugRawEnabled) {
      return null;
    }

    return {
      fullPageCaptured: false,
      fullPageScreenshotUri: null,
      reasons: [],
      source: 'debug_raw',
      step: args.stepIndex,
      summary: 'Raw capture is enabled for debugging.',
      url: args.currentUrl,
    };
  }

  return {
    fullPageCaptured: false,
    fullPageScreenshotUri: null,
    reasons,
    source,
    step: args.stepIndex,
    summary: buildSummary(args.plan, args.previousObservation, reasons, source),
    url: args.currentUrl,
  };
}

export function finalizePlanningContextRequest(
  request: PlanningContextDebugRequest | null,
  observation: ObservationResult,
): PlanningContextDebugRequest | null {
  if (!request) {
    return null;
  }

  return {
    ...request,
    fullPageCaptured: observation.fullPageScreenshot !== null,
    fullPageScreenshotUri: observation.fullPageScreenshot?.uri ?? null,
  };
}

export function toInferencePlanningContext(
  request: PlanningContextDebugRequest | null,
): InferencePlanningContext | null {
  if (!request) {
    return null;
  }

  if (
    request.source === 'debug_raw' ||
    !request.fullPageCaptured ||
    !request.fullPageScreenshotUri ||
    request.reasons.length === 0
  ) {
    return null;
  }

  return {
    fullPageScreenshotUri: request.fullPageScreenshotUri,
    reasons: request.reasons,
    summary: request.summary,
  };
}

function getPostNavigationReason(
  history: AgentActionRecord[],
): PlanningContextReason | null {
  const lastAction = history[history.length - 1] ?? null;
  if (
    lastAction &&
    lastAction.urlBefore &&
    lastAction.urlAfter &&
    lastAction.urlBefore !== lastAction.urlAfter
  ) {
    return 'post_navigation';
  }

  return null;
}

function getRepeatedFailureReason(
  history: AgentActionRecord[],
): PlanningContextReason | null {
  const recent = history.slice(-2);
  if (recent.length < 2) {
    return null;
  }

  const allFailures = recent.every((record) =>
    record.status === 'no_op' ||
    record.status === 'blocked' ||
    record.status === 'stale_ref' ||
    record.status === 'failed',
  );

  return allFailures ? 'repeated_failure' : null;
}

function getSparseRefsReason(
  plan: SessionPlan | null,
  previousObservation: ObservationResult | null,
): PlanningContextReason | null {
  if (!plan || !previousObservation || !RICH_CONTEXT_PHASES.has(plan.phase)) {
    return null;
  }

  const refCount = Object.keys(previousObservation.debug.combinedRefMap).length;
  return refCount > 0 && refCount <= 3 ? 'sparse_refs' : null;
}

function getPlanAmbiguityReason(
  plan: SessionPlan | null,
  history: AgentActionRecord[],
): PlanningContextReason | null {
  if (!plan || !RICH_CONTEXT_PHASES.has(plan.phase)) {
    return null;
  }

  const activeItem =
    plan.items.find((item) => item.id === plan.activeItemId) ?? null;
  if (!activeItem || activeItem.status !== 'in_progress') {
    return null;
  }

  if (activeItem.evidence) {
    return null;
  }

  return history.length >= 2 ? 'plan_ambiguity' : null;
}

function dedupeReasons(
  reasons: (PlanningContextReason | null)[],
): PlanningContextReason[] {
  return Array.from(
    new Set(reasons.filter((reason): reason is PlanningContextReason => reason !== null)),
  );
}

function getRequestSource(
  hasPlanningReason: boolean,
  debugRawEnabled: boolean,
): PlanningContextDebugRequest['source'] | null {
  if (hasPlanningReason && debugRawEnabled) {
    return 'planning_and_debug_raw';
  }

  if (hasPlanningReason) {
    return 'planning';
  }

  if (debugRawEnabled) {
    return 'debug_raw';
  }

  return null;
}

function isDuplicatePlanningRequest(
  previousRequest: PlanningContextDebugRequest,
  reasons: PlanningContextReason[],
  currentUrl: string | null,
  stepIndex: number,
): boolean {
  if (
    previousRequest.source === 'debug_raw' ||
    previousRequest.step !== stepIndex - 1 ||
    previousRequest.url !== currentUrl
  ) {
    return false;
  }

  if (previousRequest.reasons.length !== reasons.length) {
    return false;
  }

  return previousRequest.reasons.every((reason, index) => reason === reasons[index]);
}

function buildSummary(
  plan: SessionPlan | null,
  previousObservation: ObservationResult | null,
  reasons: PlanningContextReason[],
  source: PlanningContextDebugRequest['source'],
): string {
  if (source === 'debug_raw') {
    return 'Raw capture is enabled for debugging.';
  }

  const activeItem =
    plan?.items.find((item) => item.id === plan.activeItemId) ?? null;
  const refCount = previousObservation
    ? Object.keys(previousObservation.debug.combinedRefMap).length
    : null;

  const reasonSummary = reasons
    .map((reason) => describeReason(reason))
    .join('; ');
  const todoSummary = activeItem ? `Active todo: ${activeItem.text}.` : null;
  const refSummary =
    refCount !== null ? `Previous observation exposed ${refCount} refs.` : null;

  return [reasonSummary, todoSummary, refSummary].filter(Boolean).join(' ');
}

function describeReason(reason: PlanningContextReason): string {
  switch (reason) {
    case 'post_navigation':
      return 'A navigation just completed.';
    case 'repeated_failure':
      return 'Recent actions failed without visible progress.';
    case 'sparse_refs':
      return 'The current page exposes very few usable refs.';
    case 'plan_ambiguity':
      return 'The active todo is still unresolved and recent evidence is weak.';
  }
}
