import type { ObservationResult, SessionPlan } from '../../../../types/agent';
import {
  analyzeTargetEntry,
  buildInferenceTargetSummary,
  getTargetSummaryEntry,
  isEditableTargetEntry,
} from '../target-analysis';

function makeObservationResult(
  combinedRefMap: ObservationResult['debug']['combinedRefMap'],
  axTreeText: string,
): ObservationResult {
  return {
    axSnapshot: [],
    axTreeText,
    debug: {
      combinedRefMap,
      expectedFrameIds: [],
      frameArtifacts: [],
      timedOut: false,
    },
    frameSnapshots: [],
    fullPageScreenshot: null,
    observedAt: '2026-04-09T00:00:00.000Z',
    quiescence: {
      idleThresholdMs: 300,
      lastActivityAt: null,
      observedFrameCount: 1,
      satisfied: true,
      timedOut: false,
      waitTimeMs: 300,
    },
    screenshot: {
      capturedAt: '2026-04-09T00:00:00.000Z',
      height: 100,
      orientation: 'portrait',
      pointHeight: 100,
      pointWidth: 100,
      scale: 1,
      uri: 'file:///tmp/test.png',
      width: 100,
    },
    warnings: [],
  };
}

function makePlan(phase: SessionPlan['phase'], activeText: string): SessionPlan {
  return {
    activeItemId: 'todo-active',
    avoidRefs: [],
    items: [
      {
        createdAt: '2026-04-09T00:00:00.000Z',
        evidence: null,
        id: 'todo-active',
        source: 'system',
        status: 'in_progress',
        text: activeText,
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
    ],
    lastConfirmedProgress: null,
    notes: [],
    phase,
    updatedAt: '2026-04-09T00:00:00.000Z',
  };
}

describe('buildInferenceTargetSummary', () => {
  it('groups main-content links separately from global and secondary controls', () => {
    const summary = buildInferenceTargetSummary({
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult(
        {
          e1: {
            ancestorLandmarks: ['header'],
            domId: 'menu',
            label: 'Open All Categories Menu',
            landmark: 'header',
            role: 'button',
            selector: 'button',
            tagName: 'button',
            targetType: 'semantic',
            text: 'Open All Categories Menu',
          },
          e26: {
            ancestorLandmarks: ['main'],
            containerId: 'card-1',
            containerKind: 'card',
            domId: 'product-title',
            href: 'https://www.example.com/item/1',
            label: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
            landmark: 'main',
            role: 'link',
            selector: 'a[href]',
            tagName: 'a',
            targetType: 'semantic',
            text: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
          },
          e30: {
            ancestorLandmarks: ['main'],
            containerId: 'card-1',
            containerKind: 'card',
            domId: 'add-to-cart',
            label: 'Add to cart',
            landmark: 'main',
            role: 'button',
            selector: 'button[type="button"]',
            tagName: 'button',
            targetType: 'semantic',
            text: 'Add to cart',
          },
        },
        [
          '- button "Open All Categories Menu" [ref=e1]',
          '- link "COOPLUS 12 Pack Mens Cushioned Ankle Socks" [ref=e26]',
          '- button "Add to cart" [ref=e30]',
        ].join('\n'),
      ),
      plan: makePlan('results', 'Open a relevant result for: find a good deal on mens socks'),
    });

    expect(summary?.mainContent.map((entry) => entry.id)).toContain('e26');
    expect(summary?.secondaryActions.map((entry) => entry.id)).toContain('e30');
    expect(summary?.globalControls.map((entry) => entry.id)).toContain('e1');
    const title = analyzeTargetEntry('e26', {
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult(
        {
          e1: {
            ancestorLandmarks: ['header'],
            domId: 'menu',
            label: 'Open All Categories Menu',
            landmark: 'header',
            role: 'button',
            selector: 'button',
            tagName: 'button',
            targetType: 'semantic',
            text: 'Open All Categories Menu',
          },
          e26: {
            ancestorLandmarks: ['main'],
            containerId: 'card-1',
            containerKind: 'card',
            domId: 'product-title',
            href: 'https://www.example.com/item/1',
            label: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
            landmark: 'main',
            role: 'link',
            selector: 'a[href]',
            tagName: 'a',
            targetType: 'semantic',
            text: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
          },
          e30: {
            ancestorLandmarks: ['main'],
            containerId: 'card-1',
            containerKind: 'card',
            domId: 'add-to-cart',
            label: 'Add to cart',
            landmark: 'main',
            role: 'button',
            selector: 'button[type=\"button\"]',
            tagName: 'button',
            targetType: 'semantic',
            text: 'Add to cart',
          },
        },
        [
          '- button "Open All Categories Menu" [ref=e1]',
          '- link "COOPLUS 12 Pack Mens Cushioned Ankle Socks" [ref=e26]',
          '- button "Add to cart" [ref=e30]',
        ].join('\n'),
      ),
      plan: makePlan('results', 'Open a relevant result for: find a good deal on mens socks'),
    });
    expect(title?.isPrimaryInContainer).toBe(true);
  });

  it('marks generic non-editable launchers as exploratory when no editable field is available', () => {
    const summary = buildInferenceTargetSummary({
      goal: 'find a good flight to nyc in may',
      observation: makeObservationResult(
        {
          e2: {
            domId: 'from-stockholm',
            label: 'From Stockholm',
            role: 'generic',
            selector: 'li',
            tagName: 'li',
            targetType: 'generic',
            text: 'From Stockholm',
          },
          e6: {
            domId: 'cheap-flights',
            label: 'New York SEK 4,984',
            role: 'button',
            selector: 'button',
            tagName: 'button',
            targetType: 'semantic',
            text: 'New York SEK 4,984',
          },
        },
        [
          '- generic "From Stockholm" [ref=e2] clickable [cursor:pointer, exploratory]',
          '- button "New York SEK 4,984" [ref=e6]',
        ].join('\n'),
      ),
      plan: makePlan('search', 'Make initial progress toward: find a good flight to nyc in may'),
    });

    expect(summary?.editable).toHaveLength(0);
    expect(summary?.exploratoryOpeners.map((entry) => entry.id)).toContain('e2');
    const opener = getTargetSummaryEntry(summary ?? null, 'e2');
    expect(opener?.affordances).toContain('exploratory_opener');
    expect(isEditableTargetEntry(opener ?? null)).toBe(false);
  });

  it('keeps short option-like controls out of main content when they are not in structured containers', () => {
    const summary = buildInferenceTargetSummary({
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult(
        {
          e13: {
            ancestorLandmarks: ['main'],
            domId: 'filter-most-purchased',
            label: 'Most Purchased',
            landmark: 'main',
            role: 'link',
            selector: 'a[href]',
            tagName: 'a',
            targetType: 'semantic',
            text: 'Most Purchased',
          },
          e26: {
            ancestorLandmarks: ['main'],
            containerId: 'card-1',
            containerKind: 'card',
            domId: 'product-title',
            href: 'https://www.example.com/item/1',
            label: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
            landmark: 'main',
            role: 'link',
            selector: 'a[href]',
            tagName: 'a',
            targetType: 'semantic',
            text: 'COOPLUS 12 Pack Mens Cushioned Ankle Socks',
          },
        },
        [
          '- link "Most Purchased" [ref=e13]',
          '- link "COOPLUS 12 Pack Mens Cushioned Ankle Socks" [ref=e26]',
        ].join('\n'),
      ),
      plan: makePlan('results', 'Open a relevant result for: find a good deal on mens socks'),
    });

    expect(summary?.mainContent.map((entry) => entry.id)).toContain('e26');
    expect(summary?.mainContent.map((entry) => entry.id)).not.toContain('e13');
    expect(summary?.secondaryActions.map((entry) => entry.id)).toContain('e13');
  });

  it('can analyze a target that falls outside the compact prompt summary', () => {
    const combinedRefMap: ObservationResult['debug']['combinedRefMap'] = {};
    for (let index = 1; index <= 8; index += 1) {
      combinedRefMap[`e${index}`] = {
        domId: `launcher-${index}`,
        label: `Opener ${index}`,
        role: 'generic',
        selector: 'li',
        tagName: 'li',
        targetType: 'generic',
        text: `Opener ${index}`,
      };
    }
    combinedRefMap.e99 = {
      domId: 'from-stockholm',
      label: 'From Stockholm',
      role: 'generic',
      selector: 'li',
      tagName: 'li',
      targetType: 'generic',
      text: 'From Stockholm',
    };

    const observation = makeObservationResult(
      combinedRefMap,
      '- generic "From Stockholm" [ref=e99] clickable [cursor:pointer, exploratory]',
    );
    const plan = makePlan('search', 'Search for flights to nyc');
    const summary = buildInferenceTargetSummary({
      goal: 'find a flight to nyc',
      observation,
      plan,
    });

    expect(getTargetSummaryEntry(summary, 'e99')).toBeNull();

    const analyzed = analyzeTargetEntry('e99', {
      goal: 'find a flight to nyc',
      observation,
      plan,
    });
    expect(analyzed?.affordances).toContain('exploratory_opener');
    expect(isEditableTargetEntry(analyzed ?? null)).toBe(false);
  });

  it('treats real searchboxes as editable and buttons as non-editable', () => {
    const summary = buildInferenceTargetSummary({
      goal: 'find a good deal on mens socks',
      observation: makeObservationResult(
        {
          e14: {
            domId: 'search-input',
            label: 'Search Amazon',
            placeholder: 'Search Amazon',
            role: 'searchbox',
            selector: 'input[role="searchbox"][type="text"][name="k"]',
            tagName: 'input',
            targetType: 'semantic',
            text: '',
          },
          e38: {
            domId: 'search-submit',
            label: 'Go',
            role: 'button',
            selector: 'input[type="submit"]',
            tagName: 'input',
            targetType: 'semantic',
            text: 'Go',
          },
        },
        [
          '- searchbox "Search Amazon" [ref=e14]',
          '- button "Go" [ref=e38]',
        ].join('\n'),
      ),
      plan: makePlan('search', 'Search or navigate toward: find a good deal on mens socks'),
    });

    expect(summary?.editable.map((entry) => entry.id)).toContain('e14');
    expect(summary?.editable.map((entry) => entry.id)).not.toContain('e38');
    expect(isEditableTargetEntry(getTargetSummaryEntry(summary ?? null, 'e14'))).toBe(true);
    expect(isEditableTargetEntry(getTargetSummaryEntry(summary ?? null, 'e38'))).toBe(false);
  });
});
