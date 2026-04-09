import type {
  InferenceTargetSummary,
  InteractionIntent,
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
const GLOBAL_LANDMARKS = new Set(['header', 'footer', 'navigation']);
const MAIN_LANDMARKS = new Set(['main', 'article', 'region']);
const STRUCTURAL_CONTAINERS = new Set(['card', 'list_item', 'row']);

export function buildInferenceTargetSummary(
  input: AnalyzeTargetInput,
): InferenceTargetSummary | null {
  const descriptors = Object.entries(input.observation.debug.combinedRefMap)
    .map(([id, entry]) => describeTarget(id, entry))
    .filter((entry): entry is TargetDescriptor => entry !== null);

  if (descriptors.length === 0) {
    return null;
  }

  markPrimaryTargets(descriptors);
  const intent = resolveInteractionIntent(input, descriptors);
  descriptors.forEach((descriptor) => {
    const ranked = rankTarget(descriptor, intent);
    descriptor.priority = ranked.priority;
    descriptor.priorityReason = ranked.priorityReason;
    descriptor.score = ranked.score;
  });

  return {
    intent,
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
  const descriptors = Object.entries(input.observation.debug.combinedRefMap)
    .map(([id, entry]) => describeTarget(id, entry))
    .filter((entry): entry is TargetDescriptor => entry !== null);
  if (descriptors.length === 0) {
    return null;
  }

  markPrimaryTargets(descriptors);
  const intent = resolveInteractionIntent(input, descriptors);
  const descriptor = descriptors.find((entry) => entry.id === targetId);
  if (!descriptor) {
    return null;
  }

  const ranked = rankTarget(descriptor, intent);
  descriptor.priority = ranked.priority;
  descriptor.priorityReason = ranked.priorityReason;
  descriptor.score = ranked.score;

  return stripDescriptor(descriptor);
}

export function isEditableTargetEntry(
  entry: TargetSummaryEntry | null,
): boolean {
  return Boolean(entry?.capabilities.includes('type') || entry?.capabilities.includes('select'));
}

export function deriveInteractionIntent(
  input: AnalyzeTargetInput,
): InteractionIntent {
  const descriptors = Object.entries(input.observation.debug.combinedRefMap)
    .map(([id, entry]) => describeTarget(id, entry))
    .filter((entry): entry is TargetDescriptor => entry !== null);
  return resolveInteractionIntent(input, descriptors);
}

function describeTarget(
  id: string,
  entry: ObservationRefEntry,
): TargetDescriptor | null {
  const targetType = resolveTargetType(entry);
  const label = compactLabel(entry);
  const role = entry.role || 'generic';
  const capabilities = deriveCapabilities(entry);
  const affordances = deriveAffordances(entry, capabilities);
  const editable =
    capabilities.includes('type') || capabilities.includes('select');

  return {
    affordances,
    ancestorLandmarks: entry.ancestorLandmarks ?? [],
    capabilities,
    containerId: entry.containerId ?? null,
    containerKind: entry.containerKind ?? null,
    editable,
    id,
    isPrimaryInContainer: false,
    label,
    landmark: entry.landmark ?? null,
    priority: 'neutral',
    priorityReason: 'Useful but not strongly preferred for the current step.',
    role,
    score: 0,
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

  if (/\b(show|hide|more|details|expand|collapse|learn more|filters?)\b/.test(label)) {
    affordances.add('disclosure');
  }

  if (/\b(increase|decrease|next|previous|minus|plus|qty|quantity)\b/.test(label)) {
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

function resolveInteractionIntent(
  input: AnalyzeTargetInput,
  descriptors: TargetDescriptor[],
): InteractionIntent {
  const activeText =
    input.plan?.items.find((item) => item.id === input.plan?.activeItemId)?.text ?? '';
  const combined = normalize(
    [input.goal, input.plan?.phase ?? '', activeText].filter(Boolean).join(' '),
  );
  const hasEditable = descriptors.some((descriptor) => descriptor.editable);

  if (/\b(filter|sort|refine|narrow)\b/.test(combined)) {
    return 'apply_filter';
  }

  if (/\b(buy|purchase|checkout|confirm|submit|book|place order|pay)\b/.test(combined)) {
    return 'commit';
  }

  if (/\b(choose|pick|select option|select a|variant|size|color|date|time)\b/.test(combined)) {
    return 'choose_option';
  }

  if (
    (input.plan?.phase === 'search' || input.plan?.phase === 'form') &&
    hasEditable
  ) {
    return 'enter_text';
  }

  if (/\b(open|inspect|review|view|visit|navigate|result|details?)\b/.test(combined)) {
    return 'open_target';
  }

  if (input.plan?.phase === 'results' || input.plan?.phase === 'detail') {
    return 'open_target';
  }

  if (
    input.plan?.phase === 'search' ||
    input.plan?.phase === 'form' ||
    /\b(search|enter|type|fill|complete)\b/.test(combined)
  ) {
    return hasEditable ? 'enter_text' : 'explore';
  }

  return hasEditable ? 'enter_text' : 'explore';
}

function markPrimaryTargets(descriptors: TargetDescriptor[]): void {
  const byContainer = new Map<string, TargetDescriptor[]>();

  for (const descriptor of descriptors) {
    if (!descriptor.containerId) {
      continue;
    }

    const bucket = byContainer.get(descriptor.containerId) ?? [];
    bucket.push(descriptor);
    byContainer.set(descriptor.containerId, bucket);
  }

  for (const bucket of byContainer.values()) {
    let primary: TargetDescriptor | null = null;

    for (const descriptor of bucket) {
      const candidateScore = scorePrimaryCandidate(descriptor);
      if (!primary || candidateScore > scorePrimaryCandidate(primary)) {
        primary = descriptor;
      }
    }

    if (primary) {
      primary.isPrimaryInContainer = true;
    }
  }
}

function scorePrimaryCandidate(descriptor: TargetDescriptor): number {
  let score = 0;
  const wordCount = descriptor.label.split(/\s+/).filter(Boolean).length;

  if (descriptor.targetType === 'semantic') {
    score += 20;
  } else {
    score -= 30;
  }
  if (descriptor.affordances.includes('navigation_leaf')) {
    score += 90;
  }
  if (descriptor.affordances.includes('text_entry')) {
    score += 55;
  }
  if (descriptor.affordances.includes('direct_action')) {
    score += 20;
  }
  if (descriptor.affordances.includes('container')) {
    score -= 25;
  }
  if (wordCount >= 4 && wordCount <= 18) {
    score += Math.min(40, wordCount * 3);
  } else if (wordCount <= 2) {
    score -= 15;
  }
  if (descriptor.landmark && GLOBAL_LANDMARKS.has(descriptor.landmark)) {
    score -= 10;
  }

  return score;
}

function rankTarget(
  descriptor: TargetDescriptor,
  intent: InteractionIntent,
): { priority: TargetPriority; priorityReason: string; score: number } {
  let score = 0;
  let priority: TargetPriority = 'neutral';
  let priorityReason = 'Useful but not strongly preferred for the current step.';

  const isGlobal = isGlobalControl(descriptor);
  const isStructuredContent =
    (descriptor.containerKind !== null && STRUCTURAL_CONTAINERS.has(descriptor.containerKind)) ||
    (descriptor.landmark !== null && MAIN_LANDMARKS.has(descriptor.landmark));
  const wordCount = descriptor.label.split(/\s+/).filter(Boolean).length;

  if (descriptor.targetType === 'semantic') {
    score += 20;
  } else {
    score -= 20;
  }
  if (descriptor.editable) {
    score += 45;
  }
  if (descriptor.affordances.includes('navigation_leaf')) {
    score += 50;
  }
  if (descriptor.affordances.includes('direct_action')) {
    score += 15;
  }
  if (descriptor.affordances.includes('option_like')) {
    score += 10;
  }
  if (descriptor.affordances.includes('container')) {
    score -= 25;
  }
  if (descriptor.isPrimaryInContainer) {
    score += 25;
  }
  if (isStructuredContent) {
    score += 20;
  }
  if (isGlobal) {
    score -= 20;
  }
  if (wordCount >= 4 && wordCount <= 18) {
    score += 20;
  } else if (wordCount <= 2) {
    score -= 10;
  }

  if (intent === 'enter_text') {
    if (descriptor.editable) {
      score += 90;
      priority = 'preferred';
      priorityReason = 'Editable control matches the current text-entry step.';
    } else if (descriptor.affordances.includes('exploratory_opener')) {
      score += 35;
      priority = 'preferred';
      priorityReason = 'Exploratory opener may reveal a real editable control.';
    } else {
      score -= 25;
      priority = 'lower_priority';
      priorityReason = 'Not directly editable for the current text-entry step.';
    }
  } else if (intent === 'open_target') {
    if (
      descriptor.affordances.includes('navigation_leaf') &&
      descriptor.isPrimaryInContainer &&
      !isGlobal
    ) {
      score += 95;
      priority = 'preferred';
      priorityReason = 'Primary navigation leaf fits an open-or-inspect step.';
    } else if (
      descriptor.affordances.includes('navigation_leaf') &&
      isStructuredContent &&
      !isGlobal
    ) {
      score += 75;
      priority = 'preferred';
      priorityReason = 'Main-content navigation target fits an open-or-inspect step.';
    } else if (descriptor.affordances.includes('direct_action')) {
      score -= 40;
      priority = 'lower_priority';
      priorityReason = 'Direct-action control is secondary to opening a target.';
    } else if (descriptor.editable) {
      score -= 35;
      priority = 'lower_priority';
      priorityReason = 'Editable control is less relevant than opening a result right now.';
    } else if (isGlobal) {
      score -= 30;
      priority = 'lower_priority';
      priorityReason = 'Global page chrome is less useful than a main-content target.';
    }
  } else if (intent === 'apply_filter') {
    if (
      descriptor.affordances.includes('option_like') ||
      descriptor.affordances.includes('disclosure')
    ) {
      score += 70;
      priority = 'preferred';
      priorityReason = 'Option-like or disclosure control fits a filtering step.';
    } else if (descriptor.affordances.includes('navigation_leaf')) {
      score -= 20;
      priority = 'lower_priority';
      priorityReason = 'Navigation is less useful than refining the current view.';
    }
  } else if (intent === 'choose_option') {
    if (descriptor.capabilities.includes('select') || descriptor.affordances.includes('option_like')) {
      score += 65;
      priority = 'preferred';
      priorityReason = 'Selectable control fits an option-choosing step.';
    } else if (descriptor.affordances.includes('exploratory_opener')) {
      score += 20;
      priority = 'preferred';
      priorityReason = 'Exploratory opener may reveal more option controls.';
    }
  } else if (intent === 'commit') {
    if (descriptor.affordances.includes('direct_action')) {
      score += 80;
      priority = 'preferred';
      priorityReason = 'Direct-action control fits a commit or confirm step.';
    } else if (descriptor.affordances.includes('navigation_leaf')) {
      score -= 10;
      priority = 'lower_priority';
      priorityReason = 'Navigation is less useful than committing the current step.';
    }
  } else {
    if (
      (descriptor.affordances.includes('navigation_leaf') && !isGlobal) ||
      descriptor.affordances.includes('exploratory_opener')
    ) {
      score += 25;
      priority = 'preferred';
      priorityReason = 'Promising target for exploratory progress.';
    }
  }

  if (priority === 'neutral' && descriptor.targetType === 'generic') {
    priorityReason = 'Exploratory target can reveal more specific controls.';
  }

  if (priority === 'neutral') {
    if (score >= 110) {
      priority = 'preferred';
      priorityReason = 'Strong structural match for the current step.';
    } else if (score <= 10) {
      priority = 'lower_priority';
      priorityReason = 'Less relevant than other available targets for this step.';
    }
  }

  return { priority, priorityReason, score };
}

function isGlobalControl(descriptor: TargetDescriptor): boolean {
  if (descriptor.landmark && GLOBAL_LANDMARKS.has(descriptor.landmark)) {
    return true;
  }

  return descriptor.ancestorLandmarks.some((landmark) =>
    GLOBAL_LANDMARKS.has(landmark),
  );
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
    ancestorLandmarks: entry.ancestorLandmarks,
    capabilities: entry.capabilities,
    containerId: entry.containerId,
    containerKind: entry.containerKind,
    id: entry.id,
    isPrimaryInContainer: entry.isPrimaryInContainer,
    label: entry.label,
    landmark: entry.landmark,
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
