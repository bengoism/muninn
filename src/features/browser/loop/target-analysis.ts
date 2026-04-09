import type {
  InferenceTargetSummary,
  ObservationRefEntry,
  ObservationResult,
  SessionPlan,
  TargetAffordance,
  TargetCapability,
  TargetPriority,
  TargetSummaryEntry,
} from '../../../types/agent';

type TargetDescriptor = TargetSummaryEntry & {
  editable: boolean;
  score: number;
};

type AnalyzeTargetInput = {
  goal: string;
  observation: ObservationResult;
  plan: SessionPlan | null;
};

const MAX_SECTION_ITEMS = 5;
const MAX_EDITABLE_ITEMS = 3;
const MAX_EXPLORATORY_ITEMS = 3;

export function buildInferenceTargetSummary(
  input: AnalyzeTargetInput,
): InferenceTargetSummary | null {
  const descriptors = Object.entries(input.observation.debug.combinedRefMap)
    .map(([id, entry]) => describeTarget(id, entry, input))
    .filter((entry): entry is TargetDescriptor => entry !== null);

  if (descriptors.length === 0) {
    return null;
  }

  return {
    preferred: descriptors
      .filter((entry) => entry.priority === 'preferred')
      .sort(compareByScore)
      .slice(0, MAX_SECTION_ITEMS)
      .map(stripDescriptor),
    editable: descriptors
      .filter((entry) => entry.editable)
      .sort(compareByScore)
      .slice(0, MAX_EDITABLE_ITEMS)
      .map(stripDescriptor),
    exploratory: descriptors
      .filter((entry) => entry.affordances.includes('exploratory_opener'))
      .sort(compareByScore)
      .slice(0, MAX_EXPLORATORY_ITEMS)
      .map(stripDescriptor),
    lowerPriority: descriptors
      .filter((entry) => entry.priority === 'lower_priority')
      .sort(compareByScore)
      .slice(0, MAX_SECTION_ITEMS)
      .map(stripDescriptor),
  };
}

export function getTargetSummaryEntry(
  targetSummary: InferenceTargetSummary | null,
  targetId: string,
): TargetSummaryEntry | null {
  if (!targetSummary) {
    return null;
  }

  const allEntries = [
    ...targetSummary.preferred,
    ...targetSummary.editable,
    ...targetSummary.exploratory,
    ...targetSummary.lowerPriority,
  ];

  return allEntries.find((entry) => entry.id === targetId) ?? null;
}

export function analyzeTargetEntry(
  targetId: string,
  input: AnalyzeTargetInput,
): TargetSummaryEntry | null {
  const entry = input.observation.debug.combinedRefMap[targetId];
  if (!entry) {
    return null;
  }

  const descriptor = describeTarget(targetId, entry, input);
  return descriptor ? stripDescriptor(descriptor) : null;
}

export function isEditableTargetEntry(
  entry: TargetSummaryEntry | null,
): boolean {
  return Boolean(entry?.capabilities.includes('type') || entry?.capabilities.includes('select'));
}

function describeTarget(
  id: string,
  entry: ObservationRefEntry,
  input: AnalyzeTargetInput,
): TargetDescriptor | null {
  const targetType = resolveTargetType(entry);
  const label = compactLabel(entry);
  const role = entry.role || 'generic';
  const capabilities = deriveCapabilities(entry);
  const affordances = deriveAffordances(entry, capabilities);
  const editable =
    capabilities.includes('type') || capabilities.includes('select');

  const { priority, priorityReason, score } = rankTarget(
    capabilities,
    affordances,
    targetType,
    label,
    input.plan,
  );

  return {
    affordances,
    capabilities,
    editable,
    id,
    label,
    priority,
    priorityReason,
    role,
    score,
    targetType,
  };
}

function deriveCapabilities(entry: ObservationRefEntry): TargetCapability[] {
  const capabilities = new Set<TargetCapability>();
  const role = normalize(entry.role);
  const selector = normalize(entry.selector);
  const tagName = normalize(entry.tagName ?? '');

  if (
    role === 'searchbox' ||
    role === 'textbox' ||
    selector.includes('textarea') ||
    selector.includes('contenteditable') ||
    (tagName === 'input' &&
      !selector.includes('type="submit"') &&
      !selector.includes('type="button"') &&
      !selector.includes('type="reset"') &&
      !selector.includes('type="image"'))
  ) {
    capabilities.add('type');
  }

  if (role === 'combobox' || tagName === 'select' || selector.includes('select')) {
    capabilities.add('select');
  }

  if (
    role === 'link' ||
    role === 'button' ||
    resolveTargetType(entry) === 'generic' ||
    capabilities.size === 0
  ) {
    capabilities.add('click');
  }

  return [...capabilities];
}

function deriveAffordances(
  entry: ObservationRefEntry,
  capabilities: TargetCapability[],
): TargetAffordance[] {
  const affordances = new Set<TargetAffordance>();
  const role = normalize(entry.role);
  const label = normalize(compactLabel(entry));
  const href = normalize(entry.href ?? '');
  const targetType = resolveTargetType(entry);

  if (capabilities.includes('type') || capabilities.includes('select')) {
    affordances.add('text_entry');
  }

  if (role === 'link' || href.length > 0) {
    affordances.add('navigation_leaf');
  }

  if (role === 'button' && !affordances.has('text_entry')) {
    affordances.add('direct_action');
  }

  if (/\b(show|hide|more|details|expand|collapse|learn more)\b/.test(label)) {
    affordances.add('disclosure');
  }

  if (/\b(increase|decrease|next|previous|minus|plus)\b/.test(label)) {
    affordances.add('adjust_value');
  }

  if (
    capabilities.includes('click') &&
    label.length > 0 &&
    label.split(' ').length <= 4 &&
    !affordances.has('text_entry') &&
    !affordances.has('adjust_value')
  ) {
    affordances.add('option_like');
  }

  if (targetType === 'generic') {
    affordances.add('exploratory_opener');
  }

  if (entry.hasSemanticDescendants) {
    affordances.add('container');
  }

  return [...affordances];
}

function rankTarget(
  capabilities: TargetCapability[],
  affordances: TargetAffordance[],
  targetType: 'semantic' | 'generic',
  label: string,
  plan: SessionPlan | null,
): { priority: TargetPriority; priorityReason: string; score: number } {
  const activeText =
    plan?.items.find((item) => item.id === plan.activeItemId)?.text ?? '';
  const goalText = `${plan?.phase ?? ''} ${activeText}`.toLowerCase();
  const wantsNavigation = /\b(open|inspect|review|view|visit|navigate)\b/.test(goalText);
  const wantsTextEntry = /\b(search|enter|type|fill|complete|choose|select)\b/.test(goalText);
  const wantsCommit = /\b(submit|apply|confirm|book|buy|purchase|checkout|add)\b/.test(goalText);

  let score = 0;
  let priority: TargetPriority = 'neutral';
  let priorityReason = 'Useful but not strongly preferred for the current step.';

  if (capabilities.includes('type') || capabilities.includes('select')) {
    score += 50;
  }
  if (affordances.includes('navigation_leaf')) {
    score += 40;
  }
  if (affordances.includes('direct_action')) {
    score += 25;
  }
  if (targetType === 'semantic') {
    score += 20;
  } else {
    score -= 10;
  }
  if (affordances.includes('container')) {
    score -= 15;
  }
  if (label.length === 0) {
    score -= 10;
  }

  if (wantsTextEntry) {
    if (capabilities.includes('type') || capabilities.includes('select')) {
      score += 80;
      priority = 'preferred';
      priorityReason = 'Editable control matches a search or form-oriented step.';
    } else if (affordances.includes('exploratory_opener')) {
      score += 35;
      priority = 'preferred';
      priorityReason = 'Exploratory opener may reveal an editable control after activation.';
    } else {
      score -= 20;
      priority = 'lower_priority';
      priorityReason = 'Not directly editable for a search or form-oriented step.';
    }
  } else if (wantsNavigation) {
    if (affordances.includes('navigation_leaf')) {
      score += 80;
      priority = 'preferred';
      priorityReason = 'Navigation target fits an open or inspect-oriented step.';
    } else if (affordances.includes('direct_action')) {
      score -= 20;
      priority = 'lower_priority';
      priorityReason = 'Direct action control is less useful than navigation for this step.';
    }
  } else if (wantsCommit) {
    if (affordances.includes('direct_action')) {
      score += 60;
      priority = 'preferred';
      priorityReason = 'Direct action control fits a commit or confirm-oriented step.';
    } else if (affordances.includes('navigation_leaf')) {
      score += 10;
    }
  }

  if (priority === 'neutral' && targetType === 'generic') {
    priorityReason = 'Exploratory target can reveal more specific controls.';
  }

  return { priority, priorityReason, score };
}

function compactLabel(entry: ObservationRefEntry): string {
  return [entry.label, entry.text, entry.placeholder]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function resolveTargetType(
  entry: ObservationRefEntry,
): 'semantic' | 'generic' {
  if (entry.targetType) {
    return entry.targetType;
  }

  return entry.role === 'generic' ? 'generic' : 'semantic';
}

function stripDescriptor(entry: TargetDescriptor): TargetSummaryEntry {
  return {
    affordances: entry.affordances,
    capabilities: entry.capabilities,
    id: entry.id,
    label: entry.label,
    priority: entry.priority,
    priorityReason: entry.priorityReason,
    role: entry.role,
    targetType: entry.targetType,
  };
}

function compareByScore(left: TargetDescriptor, right: TargetDescriptor): number {
  return right.score - left.score || left.id.localeCompare(right.id);
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}
