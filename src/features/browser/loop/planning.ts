import type {
  AgentActionRecord,
  AvoidRef,
  ObservationResult,
  PlanItem,
  PlanPhase,
  PlanUpdateProposal,
  SessionPlan,
  StopReason,
  ToolName,
} from '../../../types/agent';
import type { ValidationResult, ValidationSnapshot } from '../tools/types';

const MAX_PLAN_ITEMS = 5;
const MAX_PLAN_NOTES = 5;

const START_ITEM_ID = 'todo-start';
const RESULTS_ITEM_ID = 'todo-results';
const DETAIL_ITEM_ID = 'todo-detail';
const FORM_ITEM_ID = 'todo-form';
const CHECKOUT_ITEM_ID = 'todo-checkout';
const MAX_MODEL_PLAN_UPDATES = 3;
const MAX_MODEL_ITEM_TEXT_LENGTH = 120;

type ObservationPlanEvent = {
  type: 'observation';
  goal: string;
  observation: ObservationResult;
  stepIndex: number;
  timestamp: string;
  url: string | null;
};

type ActionValidatedPlanEvent = {
  type: 'action_validated';
  action: ToolName;
  goal: string;
  params: Record<string, unknown>;
  postSnapshot: ValidationSnapshot;
  preSnapshot: ValidationSnapshot;
  stepIndex: number;
  timestamp: string;
  validation: ValidationResult;
};

type SessionFinishedPlanEvent = {
  type: 'session_finished';
  goal: string;
  stopReason: StopReason | null;
  timestamp: string;
};

export type SessionPlanEvent =
  | ObservationPlanEvent
  | ActionValidatedPlanEvent
  | SessionFinishedPlanEvent;

export type PlanUpdateDecision = {
  accepted: boolean;
  createdItemId: string | null;
  proposal: PlanUpdateProposal;
  reason: string;
};

type ApplyPlanUpdateContext = {
  actionHistory: AgentActionRecord[];
  goal: string;
  observation: ObservationResult;
  plan: SessionPlan | null;
  proposals: PlanUpdateProposal[] | null | undefined;
  timestamp: string;
  url: string | null;
};

export function createSessionPlan(
  goal: string,
  timestamp = new Date().toISOString(),
): SessionPlan {
  const startItem = createItem(
    START_ITEM_ID,
    buildStartText(goal, 'initial'),
    'in_progress',
    timestamp,
  );

  return {
    phase: 'initial',
    activeItemId: startItem.id,
    avoidRefs: [],
    items: [startItem],
    lastConfirmedProgress: null,
    notes: [],
    updatedAt: timestamp,
  };
}

export function reduceSessionPlan(
  plan: SessionPlan | null,
  event: SessionPlanEvent,
): SessionPlan {
  const current = plan ?? createSessionPlan(event.goal, event.timestamp);

  switch (event.type) {
    case 'observation':
      return reduceObservationEvent(current, event);
    case 'action_validated':
      return reduceActionValidatedEvent(current, event);
    case 'session_finished':
      return reduceSessionFinishedEvent(current, event);
  }
}

export function findActiveAvoidRef(
  plan: SessionPlan | null,
  ref: string,
  stepIndex: number,
): AvoidRef | null {
  if (!plan) {
    return null;
  }

  return (
    plan.avoidRefs.find(
      (entry) => entry.ref === ref && entry.expiresAfterStep > stepIndex,
    ) ?? null
  );
}

export function addAvoidRef(
  plan: SessionPlan,
  ref: string,
  reason: string,
  stepIndex: number,
  timestamp: string,
  durationSteps = 3,
): SessionPlan {
  const next = pruneExpiredAvoidRefs(clonePlan(plan), stepIndex);
  const expiresAfterStep = stepIndex + durationSteps;
  const nextEntry: AvoidRef = {
    expiresAfterStep,
    reason,
    ref,
  };

  const existingIndex = next.avoidRefs.findIndex((entry) => entry.ref === ref);
  if (existingIndex >= 0) {
    next.avoidRefs[existingIndex] = nextEntry;
  } else {
    next.avoidRefs.push(nextEntry);
  }

  next.notes = appendNote(
    next.notes,
    `Avoiding ${ref} until step ${expiresAfterStep}: ${reason}`,
  );

  return finalizePlan(next, timestamp);
}

export function applyPlanUpdateProposals(
  context: ApplyPlanUpdateContext,
): { decisions: PlanUpdateDecision[]; plan: SessionPlan } {
  const current = context.plan ?? createSessionPlan(context.goal, context.timestamp);
  const proposals = context.proposals ?? [];
  const decisions: PlanUpdateDecision[] = [];

  if (proposals.length === 0) {
    return { decisions, plan: current };
  }

  let next = clonePlan(current);
  const limitedProposals = proposals.slice(0, MAX_MODEL_PLAN_UPDATES);
  const inferredPhase = detectPhase(
    context.url,
    context.observation,
    next.phase,
  );

  for (const proposal of limitedProposals) {
    const applied = applySinglePlanUpdate({
      actionHistory: context.actionHistory,
      goal: context.goal,
      inferredPhase,
      observation: context.observation,
      plan: next,
      proposal,
      timestamp: context.timestamp,
      url: context.url,
    });
    next = applied.plan;
    decisions.push(applied.decision);
    next.notes = appendNote(next.notes, describePlanUpdateDecision(applied.decision));
  }

  for (const proposal of proposals.slice(MAX_MODEL_PLAN_UPDATES)) {
    const decision: PlanUpdateDecision = {
      accepted: false,
      createdItemId: null,
      proposal,
      reason: `Only the first ${MAX_MODEL_PLAN_UPDATES} plan updates are considered per step.`,
    };
    decisions.push(decision);
    next.notes = appendNote(next.notes, describePlanUpdateDecision(decision));
  }

  return {
    decisions,
    plan: finalizePlan(next, context.timestamp),
  };
}

function reduceObservationEvent(
  current: SessionPlan,
  event: ObservationPlanEvent,
): SessionPlan {
  let next = clonePlan(current);
  next = pruneExpiredAvoidRefs(next, event.stepIndex);

  const detectedPhase = detectPhase(event.url, event.observation, next.phase);
  if (detectedPhase !== next.phase) {
    next.notes = appendNote(
      next.notes,
      `Phase changed from ${next.phase} to ${detectedPhase}.`,
    );
  }
  next.phase = detectedPhase;

  const evidence = describePhaseProgress(detectedPhase, event.url);
  if (evidence) {
    next.lastConfirmedProgress = evidence;
  }

  next = reconcilePlanForPhase(next, event.goal, detectedPhase, event.timestamp, evidence);
  return finalizePlan(next, event.timestamp);
}

function reduceActionValidatedEvent(
  current: SessionPlan,
  event: ActionValidatedPlanEvent,
): SessionPlan {
  let next = clonePlan(current);
  next = pruneExpiredAvoidRefs(next, event.stepIndex);

  const progress = describeActionProgress(event);
  if (progress) {
    next.lastConfirmedProgress = progress;
    next.notes = appendNote(next.notes, progress);
    next = annotateActiveItem(next, progress, event.timestamp);
  }

  if (event.validation.outcome === 'blocked') {
    next.notes = appendNote(
      next.notes,
      event.validation.reason ?? 'The last action was blocked by the page.',
    );
  }

  return finalizePlan(next, event.timestamp);
}

function reduceSessionFinishedEvent(
  current: SessionPlan,
  event: SessionFinishedPlanEvent,
): SessionPlan {
  let next = clonePlan(current);

  switch (event.stopReason) {
    case 'goal_complete':
      next.phase = 'done';
      next.lastConfirmedProgress = 'The agent marked the goal complete.';
      if (next.activeItemId) {
        next = setItemStatus(
          next,
          next.activeItemId,
          'completed',
          event.timestamp,
          'The agent marked the goal complete.',
        );
      }
      next.notes = appendNote(next.notes, 'Session finished with goal complete.');
      break;
    case 'yielded_to_user':
    case 'modal_blocked':
      next.phase = 'blocked';
      if (next.activeItemId) {
        next = setItemStatus(
          next,
          next.activeItemId,
          'blocked',
          event.timestamp,
          'The agent is waiting for user help to continue.',
        );
      }
      next.notes = appendNote(next.notes, 'Session is waiting for user input.');
      break;
    case 'user_cancelled':
      next.notes = appendNote(next.notes, 'Session was cancelled by the user.');
      break;
    case 'step_budget_exhausted':
    case 'time_budget_exhausted':
    case 'repeated_identical_failure':
    case 'consecutive_no_ops':
    case 'unrecoverable_error':
      next.notes = appendNote(
        next.notes,
        `Session stopped: ${event.stopReason}.`,
      );
      break;
    default:
      break;
  }

  return finalizePlan(next, event.timestamp);
}

function reconcilePlanForPhase(
  plan: SessionPlan,
  goal: string,
  phase: PlanPhase,
  timestamp: string,
  evidence: string | null,
): SessionPlan {
  let next = plan;

  switch (phase) {
    case 'initial':
      next = ensureItem(
        next,
        START_ITEM_ID,
        buildStartText(goal, phase),
        timestamp,
      );
      return activateItem(next, START_ITEM_ID, timestamp);
    case 'search':
      next = ensureItem(
        next,
        START_ITEM_ID,
        buildStartText(goal, phase),
        timestamp,
      );
      return activateItem(next, START_ITEM_ID, timestamp);
    case 'results':
      next = ensureItem(
        next,
        START_ITEM_ID,
        buildStartText(goal, 'search'),
        timestamp,
      );
      next = setItemStatus(
        next,
        START_ITEM_ID,
        'completed',
        timestamp,
        evidence ?? 'Reached a results-like page.',
      );
      next = ensureItem(
        next,
        RESULTS_ITEM_ID,
        buildResultsText(goal),
        timestamp,
      );
      return activateItem(next, RESULTS_ITEM_ID, timestamp);
    case 'detail':
      if (hasItem(next, RESULTS_ITEM_ID)) {
        next = setItemStatus(
          next,
          RESULTS_ITEM_ID,
          'completed',
          timestamp,
          evidence ?? 'Opened a detail-like page from a result.',
        );
      } else {
        next = setItemStatus(
          ensureItem(
            next,
            START_ITEM_ID,
            buildStartText(goal, 'search'),
            timestamp,
          ),
          START_ITEM_ID,
          'completed',
          timestamp,
          evidence ?? 'Made visible progress toward the goal.',
        );
      }
      next = ensureItem(next, DETAIL_ITEM_ID, buildDetailText(goal), timestamp);
      return activateItem(next, DETAIL_ITEM_ID, timestamp);
    case 'form':
      next = ensureItem(next, FORM_ITEM_ID, buildFormText(goal), timestamp);
      return activateItem(next, FORM_ITEM_ID, timestamp);
    case 'checkout':
      if (hasItem(next, DETAIL_ITEM_ID)) {
        next = setItemStatus(
          next,
          DETAIL_ITEM_ID,
          'completed',
          timestamp,
          evidence ?? 'Reached a checkout or handoff flow.',
        );
      }
      if (hasItem(next, FORM_ITEM_ID)) {
        next = setItemStatus(
          next,
          FORM_ITEM_ID,
          'completed',
          timestamp,
          evidence ?? 'Finished the current form or picker step.',
        );
      }
      next = ensureItem(
        next,
        CHECKOUT_ITEM_ID,
        buildCheckoutText(goal),
        timestamp,
      );
      return activateItem(next, CHECKOUT_ITEM_ID, timestamp);
    case 'blocked':
      if (next.activeItemId) {
        next = setItemStatus(
          next,
          next.activeItemId,
          'blocked',
          timestamp,
          evidence ?? 'The page appears blocked or waiting for user help.',
        );
      }
      return next;
    case 'done':
      if (next.activeItemId) {
        next = setItemStatus(
          next,
          next.activeItemId,
          'completed',
          timestamp,
          evidence ?? 'The flow appears complete.',
        );
      }
      return next;
  }
}

function detectPhase(
  url: string | null,
  observation: ObservationResult,
  previousPhase: PlanPhase,
): PlanPhase {
  const urlText = (url ?? '').toLowerCase();
  const treeText = observation.axTreeText.toLowerCase();
  const refEntries = Object.values(observation.debug.combinedRefMap);
  const textEntryCount = refEntries.filter((entry) =>
    isTextEntryRole(entry.role),
  ).length;
  const hasSearchbox = refEntries.some((entry) => entry.role === 'searchbox');
  const hasResultsUrl = /[?&](k|q|query|search|keyword|keywords)=/.test(urlText);
  const hasResultsWords =
    /\bresults\b/.test(treeText) ||
    /\bsearch results\b/.test(treeText) ||
    /\bmore results\b/.test(treeText) ||
    /\bsort by\b/.test(treeText) ||
    /\blist \(ordered\)\b/.test(treeText);
  const hasDetailPath =
    /\/(dp|gp\/product|product|item)\//.test(urlText) ||
    /\/details\b/.test(urlText);
  const hasDetailWords =
    /\b(add to cart|buy now|about this item|product details|specifications|quantity)\b/.test(
      treeText,
    );
  const hasCheckoutWords =
    /\b(checkout|shipping|billing|payment|place order|review order|shopping cart|your cart)\b/.test(
      `${urlText}\n${treeText}`,
    );
  const hasFormWords =
    /\b(origin|destination|departure|return|from|to|email|password|address|phone|date)\b/.test(
      treeText,
    );

  if (hasCheckoutWords) {
    return 'checkout';
  }

  if (hasDetailPath) {
    return 'detail';
  }

  if (hasResultsUrl || hasResultsWords) {
    return 'results';
  }

  if (hasDetailWords) {
    return 'detail';
  }

  if (textEntryCount >= 2 || (hasFormWords && textEntryCount >= 1)) {
    return 'form';
  }

  if (hasSearchbox) {
    return 'search';
  }

  return previousPhase === 'initial' ? 'initial' : previousPhase;
}

function describePhaseProgress(
  phase: PlanPhase,
  url: string | null,
): string | null {
  switch (phase) {
    case 'results':
      return 'Reached a results-like page.';
    case 'detail':
      return url
        ? `Opened a detail-like page at ${url}.`
        : 'Opened a detail-like page.';
    case 'form':
      return 'A form, picker, or modal-like editing surface is active.';
    case 'checkout':
      return 'Entered a checkout or handoff flow.';
    case 'done':
      return 'The current flow appears complete.';
    default:
      return null;
  }
}

function describeActionProgress(event: ActionValidatedPlanEvent): string | null {
  const { action, params, postSnapshot, preSnapshot, validation } = event;

  if (
    validation.outcome !== 'success' &&
    validation.outcome !== 'partial_success' &&
    validation.outcome !== 'blocked'
  ) {
    return null;
  }

  if (validation.signals.urlChanged) {
    return `Navigation advanced after ${action} to ${postSnapshot.url ?? 'a new page'}.`;
  }

  if ((action === 'type' || action === 'fill') && typeof params.text === 'string') {
    return `Entered "${compactText(params.text)}" into a page field.`;
  }

  if (action === 'scroll' && validation.signals.scrollChanged) {
    return 'Scrolled to reveal more of the page.';
  }

  if (validation.outcome === 'blocked') {
    return validation.reason ?? 'An overlay or dialog appeared after the action.';
  }

  if (
    (action === 'click' || action === 'tap_coordinates') &&
    validation.signals.focusChanged
  ) {
    return 'Focused a new target after clicking.';
  }

  if (action === 'go_back' && preSnapshot.url !== postSnapshot.url) {
    return 'Returned to the previous page.';
  }

  if (validation.signals.axDelta.total > 0) {
    return `The page structure changed after ${action}.`;
  }

  return null;
}

function applySinglePlanUpdate(args: {
  actionHistory: AgentActionRecord[];
  goal: string;
  inferredPhase: PlanPhase;
  observation: ObservationResult;
  plan: SessionPlan;
  proposal: PlanUpdateProposal;
  timestamp: string;
  url: string | null;
}): { decision: PlanUpdateDecision; plan: SessionPlan } {
  const { inferredPhase, plan, proposal, timestamp } = args;
  const proposalType = proposal.type;

  switch (proposalType) {
    case 'add_item': {
      const text = normalizePlanText(proposal.text);
      if (!text) {
        return rejectPlanUpdate(plan, proposal, 'add_item requires non-empty text.');
      }

      if (text.length > MAX_MODEL_ITEM_TEXT_LENGTH) {
        return rejectPlanUpdate(
          plan,
          proposal,
          `add_item text must be at most ${MAX_MODEL_ITEM_TEXT_LENGTH} characters.`,
        );
      }

      if (findItemByNormalizedText(plan, text)) {
        return rejectPlanUpdate(
          plan,
          proposal,
          'A todo with the same text is already present.',
        );
      }

      const createdItemId = createModelItemId(plan);
      let next = clonePlan(plan);
      const status: PlanItem['status'] = proposal.activate ? 'in_progress' : 'pending';
      next.items.push({
        createdAt: timestamp,
        evidence: normalizeSupportText(proposal.evidence),
        id: createdItemId,
        source: 'model',
        status,
        text,
        updatedAt: timestamp,
      });
      if (proposal.activate) {
        next = activateItem(next, createdItemId, timestamp);
      }
      return acceptPlanUpdate(
        next,
        proposal,
        `Added todo "${text}".`,
        createdItemId,
      );
    }
    case 'set_active_item': {
      const id = normalizePlanIdentifier(proposal.id);
      if (!id) {
        return rejectPlanUpdate(plan, proposal, 'set_active_item requires an existing todo id.');
      }
      const item = plan.items.find((candidate) => candidate.id === id);
      if (!item) {
        return rejectPlanUpdate(plan, proposal, `Todo "${id}" was not found.`);
      }
      if (item.status === 'completed' || item.status === 'dropped') {
        return rejectPlanUpdate(
          plan,
          proposal,
          `Todo "${id}" cannot become active from status "${item.status}".`,
        );
      }
      return acceptPlanUpdate(
        activateItem(plan, id, timestamp),
        proposal,
        `Activated todo "${id}".`,
      );
    }
    case 'complete_item': {
      const id = normalizePlanIdentifier(proposal.id);
      if (!id) {
        return rejectPlanUpdate(plan, proposal, 'complete_item requires an existing todo id.');
      }
      const item = plan.items.find((candidate) => candidate.id === id);
      if (!item) {
        return rejectPlanUpdate(plan, proposal, `Todo "${id}" was not found.`);
      }
      const completionReason = validateCompletionProposal(
        item,
        plan,
        inferredPhase,
        args.url,
        args.observation,
        normalizeSupportText(proposal.evidence),
      );
      if (!completionReason.accepted) {
        return rejectPlanUpdate(plan, proposal, completionReason.reason);
      }
      return acceptPlanUpdate(
        setItemStatus(
          plan,
          id,
          'completed',
          timestamp,
          normalizeSupportText(proposal.evidence) ?? completionReason.reason,
        ),
        proposal,
        completionReason.reason,
      );
    }
    case 'reopen_item': {
      const id = normalizePlanIdentifier(proposal.id);
      if (!id) {
        return rejectPlanUpdate(plan, proposal, 'reopen_item requires an existing todo id.');
      }
      const item = plan.items.find((candidate) => candidate.id === id);
      if (!item) {
        return rejectPlanUpdate(plan, proposal, `Todo "${id}" was not found.`);
      }
      if (item.status !== 'completed' && item.status !== 'blocked') {
        return rejectPlanUpdate(
          plan,
          proposal,
          `Todo "${id}" cannot be reopened from status "${item.status}".`,
        );
      }
      if (!canReopenItem(item.id, inferredPhase)) {
        return rejectPlanUpdate(
          plan,
          proposal,
          `Current evidence does not support reopening "${id}".`,
        );
      }
      return acceptPlanUpdate(
        activateItem(
          setItemStatus(
            plan,
            id,
            'pending',
            timestamp,
            normalizeSupportText(proposal.evidence) ?? item.evidence,
          ),
          id,
          timestamp,
        ),
        proposal,
        `Reopened todo "${id}".`,
      );
    }
    case 'drop_item': {
      const id = normalizePlanIdentifier(proposal.id);
      if (!id) {
        return rejectPlanUpdate(plan, proposal, 'drop_item requires an existing todo id.');
      }
      const item = plan.items.find((candidate) => candidate.id === id);
      if (!item) {
        return rejectPlanUpdate(plan, proposal, `Todo "${id}" was not found.`);
      }
      if (item.source !== 'model') {
        return rejectPlanUpdate(
          plan,
          proposal,
          'Only model-added todos may be dropped through plan_updates.',
        );
      }
      return acceptPlanUpdate(
        setItemStatus(
          plan,
          id,
          'dropped',
          timestamp,
          normalizeSupportText(proposal.reason) ?? 'Dropped by validated model proposal.',
        ),
        proposal,
        `Dropped todo "${id}".`,
      );
    }
    case 'set_phase': {
      const phase = proposal.phase;
      if (!phase) {
        return rejectPlanUpdate(plan, proposal, 'set_phase requires a target phase.');
      }
      if (phase === 'done') {
        return rejectPlanUpdate(
          plan,
          proposal,
          'The runtime will only enter done after a terminal finish or verified completion.',
        );
      }
      const phaseSupport = validatePhaseProposal(
        phase,
        inferredPhase,
        args.actionHistory,
        args.observation,
      );
      if (!phaseSupport.accepted) {
        return rejectPlanUpdate(plan, proposal, phaseSupport.reason);
      }
      return acceptPlanUpdate(
        reconcilePlanForPhase(
          {
            ...plan,
            phase,
            lastConfirmedProgress:
              normalizeSupportText(proposal.evidence) ?? plan.lastConfirmedProgress,
          },
          args.goal,
          phase,
          timestamp,
          normalizeSupportText(proposal.evidence) ?? phaseSupport.reason,
        ),
        proposal,
        phaseSupport.reason,
      );
    }
    default:
      return rejectPlanUpdate(
        plan,
        proposal,
        `Unsupported plan update "${String(proposalType)}".`,
      );
  }
}

function acceptPlanUpdate(
  plan: SessionPlan,
  proposal: PlanUpdateProposal,
  reason: string,
  createdItemId: string | null = null,
): { decision: PlanUpdateDecision; plan: SessionPlan } {
  return {
    decision: {
      accepted: true,
      createdItemId,
      proposal,
      reason,
    },
    plan,
  };
}

function rejectPlanUpdate(
  plan: SessionPlan,
  proposal: PlanUpdateProposal,
  reason: string,
): { decision: PlanUpdateDecision; plan: SessionPlan } {
  return {
    decision: {
      accepted: false,
      createdItemId: null,
      proposal,
      reason,
    },
    plan,
  };
}

function validateCompletionProposal(
  item: PlanItem,
  plan: SessionPlan,
  inferredPhase: PlanPhase,
  url: string | null,
  observation: ObservationResult,
  proposedEvidence: string | null,
): { accepted: boolean; reason: string } {
  if (item.status === 'completed') {
    return {
      accepted: true,
      reason: `Todo "${item.id}" is already complete.`,
    };
  }

  switch (item.id) {
    case START_ITEM_ID:
      if (inferredPhase !== 'initial' && inferredPhase !== 'search') {
        return {
          accepted: true,
          reason: `Current page evidence supports completing "${item.id}".`,
        };
      }
      break;
    case RESULTS_ITEM_ID:
      if (inferredPhase === 'detail' || inferredPhase === 'checkout') {
        return {
          accepted: true,
          reason: `Current page evidence supports completing "${item.id}".`,
        };
      }
      break;
    case FORM_ITEM_ID:
      if (inferredPhase !== 'form' && inferredPhase !== 'initial') {
        return {
          accepted: true,
          reason: `Current page evidence supports completing "${item.id}".`,
        };
      }
      break;
    case DETAIL_ITEM_ID:
      if (inferredPhase === 'checkout') {
        return {
          accepted: true,
          reason: `Current page evidence supports completing "${item.id}".`,
        };
      }
      break;
    case CHECKOUT_ITEM_ID:
      if (plan.phase === 'done') {
        return {
          accepted: true,
          reason: `Current page evidence supports completing "${item.id}".`,
        };
      }
      break;
    default:
      break;
  }

  if (
    item.source === 'model' &&
    item.id === plan.activeItemId &&
    typeof plan.lastConfirmedProgress === 'string' &&
    plan.lastConfirmedProgress.length > 0 &&
    proposedEvidence !== null &&
    normalizePlanText(plan.lastConfirmedProgress)?.toLowerCase() ===
      proposedEvidence.toLowerCase()
  ) {
    return {
      accepted: true,
      reason: `Recent runtime progress supports completing "${item.id}".`,
    };
  }

  return {
    accepted: false,
    reason:
      `No verified evidence supports completing "${item.id}" from phase "${inferredPhase}" ` +
      `at ${url ?? 'the current page'} with tree text length ${observation.axTreeText.length}.`,
  };
}

function canReopenItem(id: string, inferredPhase: PlanPhase): boolean {
  switch (id) {
    case START_ITEM_ID:
      return inferredPhase === 'initial' || inferredPhase === 'search';
    case RESULTS_ITEM_ID:
      return inferredPhase === 'results';
    case DETAIL_ITEM_ID:
      return inferredPhase === 'detail';
    case FORM_ITEM_ID:
      return inferredPhase === 'form';
    case CHECKOUT_ITEM_ID:
      return inferredPhase === 'checkout';
    default:
      return false;
  }
}

function validatePhaseProposal(
  phase: PlanPhase,
  inferredPhase: PlanPhase,
  actionHistory: AgentActionRecord[],
  observation: ObservationResult,
): { accepted: boolean; reason: string } {
  const lastAction = actionHistory[actionHistory.length - 1] ?? null;

  if (phase === inferredPhase) {
    return {
      accepted: true,
      reason: `Current observation supports phase "${phase}".`,
    };
  }

  if (
    phase === 'blocked' &&
    lastAction?.status === 'blocked'
  ) {
    return {
      accepted: true,
      reason: 'Recent validated actions indicate the session is blocked.',
    };
  }

  if (
    phase === 'results' &&
    Object.keys(observation.debug.combinedRefMap).length >= 5
  ) {
    return {
      accepted: true,
      reason: 'The page exposes many candidate refs consistent with a results view.',
    };
  }

  return {
    accepted: false,
    reason: `Current observation does not support switching phase to "${phase}".`,
  };
}

function describePlanUpdateDecision(decision: PlanUpdateDecision): string {
  const label = decision.accepted ? 'Accepted' : 'Rejected';
  const createdSuffix =
    decision.createdItemId !== null ? ` (created ${decision.createdItemId})` : '';
  return `${label} model plan update ${decision.proposal.type}${createdSuffix}: ${decision.reason}`;
}

function buildStartText(goal: string, phase: PlanPhase): string {
  if (phase === 'search') {
    return `Search or navigate toward: ${compactText(goal)}`;
  }
  return `Make initial progress toward: ${compactText(goal)}`;
}

function buildResultsText(goal: string): string {
  return `Open a relevant result for: ${compactText(goal)}`;
}

function buildDetailText(goal: string): string {
  return `Inspect the selected page for: ${compactText(goal)}`;
}

function buildFormText(goal: string): string {
  return `Complete the current form or picker for: ${compactText(goal)}`;
}

function buildCheckoutText(goal: string): string {
  return `Continue through the current handoff or checkout flow for: ${compactText(goal)}`;
}

function compactText(text: string, maxLength = 80): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizePlanText(text: string | undefined): string | null {
  if (typeof text !== 'string') {
    return null;
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSupportText(text: string | undefined): string | null {
  return normalizePlanText(text);
}

function normalizePlanIdentifier(id: string | undefined): string | null {
  const normalized = normalizePlanText(id);
  return normalized ? normalized.slice(0, 80) : null;
}

function isTextEntryRole(role: string): boolean {
  return role === 'searchbox' || role === 'textbox' || role === 'combobox';
}

function createItem(
  id: string,
  text: string,
  status: PlanItem['status'],
  timestamp: string,
): PlanItem {
  return {
    createdAt: timestamp,
    evidence: null,
    id,
    source: 'system',
    status,
    text,
    updatedAt: timestamp,
  };
}

function ensureItem(
  plan: SessionPlan,
  id: string,
  text: string,
  timestamp: string,
): SessionPlan {
  const existing = plan.items.find((item) => item.id === id);
  if (!existing) {
    return {
      ...plan,
      items: [...plan.items, createItem(id, text, 'pending', timestamp)],
    };
  }

  if (existing.text === text) {
    return plan;
  }

  return {
    ...plan,
    items: plan.items.map((item) =>
      item.id === id ? { ...item, text, updatedAt: timestamp } : item,
    ),
  };
}

function setItemStatus(
  plan: SessionPlan,
  id: string,
  status: PlanItem['status'],
  timestamp: string,
  evidence: string | null,
): SessionPlan {
  let changed = false;
  const items = plan.items.map((item) => {
    if (item.id !== id) {
      return item;
    }
    changed = true;
    return {
      ...item,
      evidence: evidence ?? item.evidence,
      status,
      updatedAt: timestamp,
    };
  });

  if (!changed) {
    return plan;
  }

  return {
    ...plan,
    activeItemId:
      plan.activeItemId === id && status !== 'in_progress' ? null : plan.activeItemId,
    items,
  };
}

function activateItem(
  plan: SessionPlan,
  id: string,
  timestamp: string,
): SessionPlan {
  let found = false;
  const items: PlanItem[] = plan.items.map((item) => {
    if (item.id === id) {
      found = true;
      const status: PlanItem['status'] =
        item.status === 'completed' ? 'completed' : 'in_progress';
      return {
        ...item,
        status,
        updatedAt: timestamp,
      };
    }

    if (item.status === 'in_progress') {
      return {
        ...item,
        status: 'pending',
        updatedAt: timestamp,
      };
    }

    return item;
  });

  if (!found) {
    return plan;
  }

  return {
    ...plan,
    activeItemId: id,
    items,
  };
}

function annotateActiveItem(
  plan: SessionPlan,
  evidence: string,
  timestamp: string,
): SessionPlan {
  if (!plan.activeItemId) {
    return plan;
  }

  return {
    ...plan,
    items: plan.items.map((item) =>
      item.id === plan.activeItemId
        ? { ...item, evidence, updatedAt: timestamp }
        : item,
    ),
  };
}

function appendNote(notes: string[], note: string): string[] {
  return [...notes, note].slice(-MAX_PLAN_NOTES);
}

function findItemByNormalizedText(
  plan: SessionPlan,
  text: string,
): PlanItem | null {
  const normalized = text.toLowerCase();
  return (
    plan.items.find(
      (item) => item.text.replace(/\s+/g, ' ').trim().toLowerCase() === normalized,
    ) ?? null
  );
}

function createModelItemId(plan: SessionPlan): string {
  let candidate = `todo-model-${plan.items.filter((item) => item.source === 'model').length + 1}`;
  let counter = 1;
  while (plan.items.some((item) => item.id === candidate)) {
    counter += 1;
    candidate = `todo-model-${counter}`;
  }
  return candidate;
}

function pruneExpiredAvoidRefs(
  plan: SessionPlan,
  stepIndex: number,
): SessionPlan {
  const filtered = plan.avoidRefs.filter(
    (entry) => entry.expiresAfterStep > stepIndex,
  );

  if (filtered.length === plan.avoidRefs.length) {
    return plan;
  }

  return {
    ...plan,
    avoidRefs: filtered,
  };
}

function finalizePlan(plan: SessionPlan, timestamp: string): SessionPlan {
  return {
    ...plan,
    items: boundPlanItems(plan.items, plan.activeItemId),
    updatedAt: timestamp,
  };
}

function boundPlanItems(
  items: PlanItem[],
  activeItemId: string | null,
): PlanItem[] {
  if (items.length <= MAX_PLAN_ITEMS) {
    return items;
  }

  const next = [...items];
  while (next.length > MAX_PLAN_ITEMS) {
    const completedIndex = next.findIndex(
      (item) =>
        item.id !== activeItemId &&
        (item.status === 'completed' || item.status === 'dropped'),
    );
    if (completedIndex >= 0) {
      next.splice(completedIndex, 1);
      continue;
    }

    const pendingIndex = next.findIndex(
      (item) => item.id !== activeItemId && item.status === 'pending',
    );
    if (pendingIndex >= 0) {
      next.splice(pendingIndex, 1);
      continue;
    }

    break;
  }

  return next;
}

function hasItem(plan: SessionPlan, id: string): boolean {
  return plan.items.some((item) => item.id === id);
}

function clonePlan(plan: SessionPlan): SessionPlan {
  return {
    ...plan,
    avoidRefs: [...plan.avoidRefs],
    items: plan.items.map((item) => ({ ...item })),
    notes: [...plan.notes],
  };
}
