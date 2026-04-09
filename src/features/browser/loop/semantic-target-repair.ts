import type {
  ObservationResult,
  SessionPlan,
  ToolName,
} from '../../../types/agent';
import type { TargetReferenceState } from '../tools/types';
import {
  analyzeTargetEntry,
  buildInferenceTargetSummary,
} from './target-analysis';

type SemanticTargetRepairInput = {
  action: ToolName;
  goal: string;
  observation: ObservationResult;
  params: Record<string, unknown>;
  plan: SessionPlan | null;
  targetState: TargetReferenceState | null;
};

export type SemanticTargetRepair = {
  action: 'click';
  candidateRef: string;
  params: { id: string };
  reason: string;
  score: number;
  targetRef: string;
};

export function repairGenericClickTarget(
  input: SemanticTargetRepairInput,
): SemanticTargetRepair | null {
  if (input.action !== 'click' || input.targetState !== 'known_ref') {
    return null;
  }

  const targetId =
    typeof input.params.id === 'string' ? input.params.id.trim() : '';
  if (!targetId) {
    return null;
  }

  const analysisInput = {
    goal: input.goal,
    observation: input.observation,
    plan: input.plan,
  };
  const summary = buildInferenceTargetSummary(analysisInput);
  if (summary?.intent !== 'open_target') {
    return null;
  }

  const targetEntry =
    summary ? analyzeTargetEntry(targetId, analysisInput) : null;
  if (!targetEntry || !targetEntry.containerId) {
    return null;
  }

  if (targetEntry.targetType === 'semantic' && targetEntry.isPrimaryInContainer) {
    return null;
  }

  const targetScore = scoreRepairCandidate(targetEntry);
  let best: SemanticTargetRepair | null = null;

  for (const candidateRef of Object.keys(input.observation.debug.combinedRefMap)) {
    if (candidateRef === targetId) {
      continue;
    }

    const candidate = analyzeTargetEntry(candidateRef, analysisInput);
    if (!candidate || candidate.containerId !== targetEntry.containerId) {
      continue;
    }

    const score = scoreRepairCandidate(candidate);
    if (score <= targetScore || score < 120) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        action: 'click',
        candidateRef,
        params: { id: candidateRef },
        reason: `Redirected secondary target "${targetId}" to the primary target "${candidateRef}" in the same container.`,
        score,
        targetRef: targetId,
      };
    }
  }

  return best;
}

function scoreRepairCandidate(entry: NonNullable<ReturnType<typeof analyzeTargetEntry>>): number {
  let score = 0;
  const wordCount = entry.label.split(/\s+/).filter(Boolean).length;

  if (entry.targetType === 'semantic') {
    score += 20;
  } else {
    score -= 30;
  }
  if (entry.affordances.includes('navigation_leaf')) {
    score += 100;
  }
  if (entry.isPrimaryInContainer) {
    score += 70;
  }
  if (entry.affordances.includes('direct_action')) {
    score -= 40;
  }
  if (entry.affordances.includes('container')) {
    score -= 25;
  }
  if (entry.landmark === 'header' || entry.landmark === 'footer' || entry.landmark === 'navigation') {
    score -= 20;
  }
  if (wordCount >= 4 && wordCount <= 18) {
    score += 20;
  } else if (wordCount <= 2) {
    score -= 10;
  }

  return score;
}
