import type {
  InferenceTargetSummary,
  ObservationRefEntry,
  ObservationResult,
  SessionPlan,
  TargetAffordance,
  TargetCapability,
  TargetSummaryEntry,
  TargetSummaryGroup,
} from '../../../types/agent';

type AnalyzeTargetInput = {
  goal: string;
  observation: ObservationResult;
  plan: SessionPlan | null;
};

const MAX_MAIN_CONTENT_ITEMS = 6;
const MAX_EDITABLE_ITEMS = 3;
const MAX_EXPLORATORY_ITEMS = 4;
const MAX_SECONDARY_ITEMS = 6;
const MAX_GLOBAL_ITEMS = 4;
const GLOBAL_LANDMARKS = new Set(['header', 'footer', 'navigation']);
const MAIN_LANDMARKS = new Set(['main', 'article', 'region']);
const STRUCTURAL_CONTAINERS = new Set(['card', 'list_item', 'row']);

export function buildInferenceTargetSummary(
  input: AnalyzeTargetInput,
): InferenceTargetSummary | null {
  const descriptors = Object.entries(input.observation.debug.combinedRefMap)
    .map(([id, entry]) => describeTarget(id, entry))
    .filter((entry): entry is TargetSummaryEntry => entry !== null);

  if (descriptors.length === 0) {
    return null;
  }

  markPrimaryTargets(descriptors);

  const editable = descriptors
    .filter((entry) => isEditableTargetEntry(entry))
    .slice(0, MAX_EDITABLE_ITEMS);
  const mainContent = descriptors
    .filter((entry) => entry.group === 'main_content')
    .slice(0, MAX_MAIN_CONTENT_ITEMS);
  const exploratoryOpeners = descriptors
    .filter((entry) => entry.group === 'exploratory_opener')
    .slice(0, MAX_EXPLORATORY_ITEMS);
  const secondaryActions = descriptors
    .filter((entry) => entry.group === 'secondary_action')
    .slice(0, MAX_SECONDARY_ITEMS);
  const globalControls = descriptors
    .filter((entry) => entry.group === 'global_control')
    .slice(0, MAX_GLOBAL_ITEMS);

  return {
    editable,
    exploratoryOpeners,
    globalControls,
    mainContent,
    secondaryActions,
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
    ...targetSummary.editable,
    ...targetSummary.mainContent,
    ...targetSummary.exploratoryOpeners,
    ...targetSummary.secondaryActions,
    ...targetSummary.globalControls,
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

  const descriptor = describeTarget(targetId, entry);
  if (!descriptor) {
    return null;
  }

  const allEntries = Object.entries(input.observation.debug.combinedRefMap)
    .map(([id, candidate]) => describeTarget(id, candidate))
    .filter((candidate): candidate is TargetSummaryEntry => candidate !== null);

  markPrimaryTargets(allEntries);
  return allEntries.find((candidate) => candidate.id === targetId) ?? descriptor;
}

export function isEditableTargetEntry(
  entry: TargetSummaryEntry | null,
): boolean {
  return Boolean(entry?.capabilities.includes('type') || entry?.capabilities.includes('select'));
}

function describeTarget(
  id: string,
  entry: ObservationRefEntry,
): TargetSummaryEntry | null {
  const targetType = resolveTargetType(entry);
  const capabilities = deriveCapabilities(entry);
  const affordances = deriveAffordances(entry, capabilities);

  return {
    affordances,
    ancestorLandmarks: entry.ancestorLandmarks ?? [],
    capabilities,
    containerId: entry.containerId ?? null,
    containerKind: entry.containerKind ?? null,
    group: classifyGroup(entry, capabilities, affordances),
    id,
    isPrimaryInContainer: false,
    label: compactLabel(entry),
    landmark: entry.landmark ?? null,
    role: entry.role || 'generic',
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

  if (/\b(show|hide|more|details|expand|collapse|filters?|options?)\b/.test(label)) {
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

function classifyGroup(
  entry: ObservationRefEntry,
  capabilities: TargetCapability[],
  affordances: TargetAffordance[],
): TargetSummaryGroup {
  const targetType = resolveTargetType(entry);
  const landmark = entry.landmark ?? null;
  const inGlobalLandmark =
    (landmark !== null && GLOBAL_LANDMARKS.has(landmark)) ||
    (entry.ancestorLandmarks ?? []).some((value) => GLOBAL_LANDMARKS.has(value));
  const inMainLandmark =
    (landmark !== null && MAIN_LANDMARKS.has(landmark)) ||
    (entry.ancestorLandmarks ?? []).some((value) => MAIN_LANDMARKS.has(value));
  const inStructuredContainer =
    typeof entry.containerKind === 'string' &&
    STRUCTURAL_CONTAINERS.has(entry.containerKind);

  if (capabilities.includes('type') || capabilities.includes('select')) {
    return 'editable';
  }

  if (targetType === 'generic') {
    return 'exploratory_opener';
  }

  if (inGlobalLandmark) {
    return 'global_control';
  }

  if (inMainLandmark || inStructuredContainer) {
    if (
      affordances.includes('navigation_leaf') ||
      !affordances.includes('direct_action')
    ) {
      return 'main_content';
    }
  }

  return 'secondary_action';
}

function markPrimaryTargets(entries: TargetSummaryEntry[]): void {
  const byContainer = new Map<string, TargetSummaryEntry[]>();

  for (const entry of entries) {
    if (!entry.containerId) {
      continue;
    }

    const bucket = byContainer.get(entry.containerId) ?? [];
    bucket.push(entry);
    byContainer.set(entry.containerId, bucket);
  }

  for (const bucket of byContainer.values()) {
    const primary = bucket
      .filter((entry) => entry.group === 'main_content')
      .sort(comparePrimaryCandidate)[0];
    if (primary) {
      primary.isPrimaryInContainer = true;
    }
  }
}

function comparePrimaryCandidate(
  left: TargetSummaryEntry,
  right: TargetSummaryEntry,
): number {
  return scorePrimaryCandidate(right) - scorePrimaryCandidate(left);
}

function scorePrimaryCandidate(entry: TargetSummaryEntry): number {
  let score = 0;
  const wordCount = entry.label.split(/\s+/).filter(Boolean).length;

  if (entry.affordances.includes('navigation_leaf')) {
    score += 100;
  }
  if (entry.targetType === 'semantic') {
    score += 20;
  }
  if (entry.affordances.includes('container')) {
    score -= 30;
  }
  if (wordCount >= 4 && wordCount <= 18) {
    score += 20;
  } else if (wordCount <= 2) {
    score -= 15;
  }

  return score;
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

function normalize(value: string): string {
  return value.toLowerCase().trim();
}
