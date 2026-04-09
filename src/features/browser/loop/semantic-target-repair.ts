import type {
  ObservationRefEntry,
  ObservationResult,
  SessionPlan,
  ToolName,
} from '../../../types/agent';
import type { TargetReferenceState } from '../tools/types';

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

const BLOCKLIST_PATTERN =
  /\b(add to cart|cart|sign in|account|clear search|feedback|sponsored ad)\b/i;

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

  if (input.plan?.phase !== 'results') {
    return null;
  }

  const targetEntry = input.observation.debug.combinedRefMap[targetId];
  if (!targetEntry || resolveTargetType(targetEntry) !== 'generic') {
    return null;
  }

  const targetContext = normalize(
    [targetEntry.label, targetEntry.text].filter(Boolean).join(' '),
  );
  const goalTokens = new Set(tokenize(normalize(input.goal)));

  let best: SemanticTargetRepair | null = null;

  for (const [candidateRef, candidate] of Object.entries(
    input.observation.debug.combinedRefMap,
  )) {
    if (candidateRef === targetId) {
      continue;
    }

    const score = scoreSemanticCandidate(
      candidate,
      targetContext,
      goalTokens,
    );

    if (score < 120) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        action: 'click',
        candidateRef,
        params: { id: candidateRef },
        reason: `Redirected generic click target "${targetId}" to semantic ref "${candidateRef}".`,
        score,
        targetRef: targetId,
      };
    }
  }

  return best;
}

function scoreSemanticCandidate(
  candidate: ObservationRefEntry,
  targetContext: string,
  goalTokens: Set<string>,
): number {
  if (resolveTargetType(candidate) !== 'semantic') {
    return 0;
  }

  const role = normalize(candidate.role);
  const text = normalize(
    [candidate.label, candidate.text, candidate.placeholder].filter(Boolean).join(' '),
  );
  const href = normalize(candidate.href ?? '');

  if (!text && !href) {
    return 0;
  }

  if (BLOCKLIST_PATTERN.test(text) || BLOCKLIST_PATTERN.test(href)) {
    return 0;
  }

  let score = role === 'link' ? 60 : 20;

  if (/\b(go to detail page|detail page)\b/.test(text)) {
    score += 80;
  }

  if (href.includes('/dp/') || href.includes('/gp/') || href.includes('detail')) {
    score += 50;
  }

  const candidateTokens = tokenize(text);
  let sharedTargetTokens = 0;
  for (const token of candidateTokens) {
    if (token.length >= 4 && targetContext.includes(token)) {
      sharedTargetTokens += 1;
    }
    if (token.length >= 4 && goalTokens.has(token)) {
      score += 6;
    }
  }

  score += sharedTargetTokens * 24;

  if (targetContext) {
    if (text && (text.includes(targetContext) || targetContext.includes(text))) {
      score += 100;
    }
    if (href && targetContext && href.includes(tokenize(targetContext)[0] ?? '')) {
      score += 10;
    }
  }

  if (candidate.hasSemanticDescendants) {
    score -= 20;
  }

  return score;
}

function resolveTargetType(entry: ObservationRefEntry): 'semantic' | 'generic' {
  if (entry.targetType) {
    return entry.targetType;
  }

  return entry.role === 'generic' ? 'generic' : 'semantic';
}

function tokenize(value: string): string[] {
  return value
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s/:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
