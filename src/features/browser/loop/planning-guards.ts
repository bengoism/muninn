import type {
  AgentActionRecord,
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
