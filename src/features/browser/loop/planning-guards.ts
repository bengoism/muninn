import type {
  AgentActionRecord,
  ObservationResult,
  SessionPlan,
  ToolName,
} from '../../../types/agent';
import type { ValidationSnapshot } from '../tools/types';

export function hasRepeatedNoOpOnTarget(
  history: AgentActionRecord[],
  action: ToolName,
  targetId: string,
  count = 2,
): boolean {
  let matches = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index];
    if (
      record.action === action &&
      record.status === 'no_op' &&
      record.parameters.id === targetId
    ) {
      matches += 1;
      if (matches >= count) {
        return true;
      }
      continue;
    }

    break;
  }

  return false;
}

export function shouldGuardSearchboxTarget(
  plan: SessionPlan | null,
  snapshot: ValidationSnapshot,
  targetId: string,
  action: ToolName,
): boolean {
  if (!plan) {
    return false;
  }

  if (
    plan.phase !== 'results' &&
    plan.phase !== 'detail' &&
    plan.phase !== 'checkout'
  ) {
    return false;
  }

  if (plan.activeItemId === 'todo-start') {
    return false;
  }

  if (action !== 'click' && action !== 'focus') {
    return false;
  }

  const domId = snapshot.refToDomId.get(targetId) ?? targetId;
  return snapshot.axNodeRoles.get(domId) === 'searchbox';
}

export function shouldBlockFinishSuccess(args: {
  goal: string;
  message: string | null;
  observation: ObservationResult;
  plan: SessionPlan | null;
}): string | null {
  const { goal, message, observation, plan } = args;

  if (!plan) {
    return null;
  }

  const activeItem =
    plan.items.find((item) => item.id === plan.activeItemId) ?? null;
  const normalizedMessage = (message ?? '').toLowerCase();
  const normalizedGoal = goal.toLowerCase();
  const treeText = observation.axTreeText.toLowerCase();

  const hasFutureIntent =
    /\b(will|going to|next|then|examine|inspect|compare|review|open|select)\b/.test(
      normalizedMessage,
    );
  const goalNeedsInspection =
    /\b(good deal|best|cheap|cheapest|compare|review|inspect|shipping|seller|price|buy|purchase|open)\b/.test(
      normalizedGoal,
    );
  const hasVisibleResults =
    /\bresults\b/.test(treeText) &&
    /\b(add to cart|sponsored|bought in past month|overall pick|best seller)\b/.test(
      treeText,
    );

  if (plan.phase === 'form' || plan.phase === 'search') {
    return activeItem
      ? `The active todo "${activeItem.text}" is still unresolved.`
      : 'The current page still looks like an in-progress search or form step.';
  }

  if (
    plan.phase === 'results' &&
    activeItem?.id === 'todo-results' &&
    activeItem.status === 'in_progress' &&
    (hasFutureIntent || goalNeedsInspection || hasVisibleResults)
  ) {
    return `The active todo "${activeItem.text}" is still unresolved on a results page.`;
  }

  if (
    activeItem &&
    (activeItem.status === 'pending' || activeItem.status === 'in_progress') &&
    hasFutureIntent
  ) {
    return `The active todo "${activeItem.text}" is still unresolved.`;
  }

  return null;
}
