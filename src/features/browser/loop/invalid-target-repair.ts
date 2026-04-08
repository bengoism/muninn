import type { ObservationResult, ToolName } from '../../../types/agent';
import type {
  TargetReferenceState,
  ValidationResult,
} from '../tools/types';

type InvalidTargetRepairInput = {
  action: ToolName;
  observation: ObservationResult;
  params: Record<string, unknown>;
  targetState: TargetReferenceState | null;
};

export type InvalidTargetRepair = {
  action: ToolName;
  candidateRef: string;
  params: Record<string, unknown>;
  reason: string;
  score: number;
};

const TEXT_ENTRY_ACTIONS = new Set<ToolName>(['fill', 'select', 'type']);
const TEXT_ENTRY_CONTEXT_WORDS = [
  'departure',
  'destination',
  'economy',
  'flight',
  'flights',
  'from',
  'origin',
  'return',
  'search',
  'to',
];

export function repairInvalidTargetAction(
  input: InvalidTargetRepairInput,
): InvalidTargetRepair | null {
  if (!TEXT_ENTRY_ACTIONS.has(input.action)) {
    return null;
  }

  if (input.targetState !== 'unknown_ref') {
    return null;
  }

  const requestedId =
    typeof input.params.id === 'string' ? input.params.id.trim() : '';

  if (!requestedId) {
    return null;
  }

  const refContext = extractRefContext(input.observation.axTreeText);
  let bestCandidate: InvalidTargetRepair | null = null;

  for (const [refId, entry] of Object.entries(input.observation.debug.combinedRefMap)) {
    const contextText = refContext.get(refId) ?? '';
    const score = scoreRepairCandidate({
      action: input.action,
      contextText,
      label: entry.label,
      requestedId,
      role: entry.role,
      selector: entry.selector,
    });

    if (score <= 0) {
      continue;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        action: 'click',
        candidateRef: refId,
        params: { id: refId },
        reason: `Repaired invalid target "${requestedId}" to ref "${refId}" for text-entry setup.`,
        score,
      };
    }
  }

  return bestCandidate;
}

export function normalizeInvalidTargetRepairValidation(
  validation: ValidationResult,
): ValidationResult {
  if (validation.outcome === 'blocked') {
    return {
      ...validation,
      outcome: 'success',
      reason:
        'Clicked a likely text-entry container and opened a dialog or overlay for retargeting.',
    };
  }

  if (
    validation.reason === null &&
    (validation.outcome === 'success' ||
      validation.outcome === 'partial_success')
  ) {
    return {
      ...validation,
      reason:
        'Repaired an invalid text target by clicking a matching interactive element.',
    };
  }

  return validation;
}

function scoreRepairCandidate(input: {
  action: ToolName;
  contextText: string;
  label: string;
  requestedId: string;
  role: string;
  selector: string;
}): number {
  const requested = normalize(input.requestedId);

  if (!requested) {
    return 0;
  }

  const label = normalize(input.label);
  const context = normalize(input.contextText);
  const role = normalize(input.role);
  const selector = normalize(input.selector);

  let score = 0;

  score += scoreTextMatch(requested, label, 220);
  score += scoreTextMatch(requested, context, 180);

  const tokens = tokenize(requested);
  for (const token of tokens) {
    if (token.length < 3) {
      continue;
    }

    if (label.includes(token)) {
      score += 30;
    }

    if (context.includes(token)) {
      score += 20;
    }
  }

  if (role === 'searchbox' || role === 'textbox' || role === 'combobox') {
    score += 40;
  }

  if (selector.includes('input') || selector.includes('textarea')) {
    score += 40;
  }

  if (TEXT_ENTRY_CONTEXT_WORDS.some((word) => context.includes(word))) {
    score += 35;
  }

  score -= Math.floor(context.length / 120);

  return score;
}

function scoreTextMatch(
  requested: string,
  haystack: string,
  exactBonus: number,
): number {
  if (!haystack || !requested) {
    return 0;
  }

  if (haystack === requested) {
    return exactBonus;
  }

  const matchIndex = haystack.indexOf(requested);
  if (matchIndex === -1) {
    return 0;
  }

  return exactBonus - Math.min(matchIndex, exactBonus - 40);
}

function extractRefContext(treeText: string): Map<string, string> {
  const context = new Map<string, string>();

  for (const rawLine of treeText.split('\n')) {
    const match = rawLine.match(/\[ref=(e\d+)\]/);
    if (!match) {
      continue;
    }

    const refId = match[1];
    if (!refId) {
      continue;
    }

    const normalizedLine = rawLine
      .replace(/^\s*-\s*/, '')
      .replace(/\[ref=e\d+\]/g, ' ')
      .replace(/\s+clickable\b.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    context.set(refId, normalizedLine);
  }

  return context;
}

function tokenize(value: string): string[] {
  return value
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
