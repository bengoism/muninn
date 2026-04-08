import type { ObservationResult } from '../../../../types/agent';
import type { ValidationResult } from '../../tools/types';
import {
  normalizeInvalidTargetRepairValidation,
  repairInvalidTargetAction,
} from '../invalid-target-repair';

function createObservationResult(): ObservationResult {
  return {
    axSnapshot: [],
    axTreeText: [
      '- main',
      '  - generic "Flexible travel ideas and popular destinations from Sweden Stockholm London Milan Paris" [ref=e1] clickable [cursor:pointer]',
      '  - generic "Change appearance Travel Explore Flights Hotels Vacation rentals" [ref=e2] clickable [cursor:pointer]',
      '  - generic "Flights Round trip 1 Economy Stockholm Departure Return Explore deals" [ref=e3] clickable [cursor:pointer]',
    ].join('\n'),
    debug: {
      combinedRefMap: {
        e1: {
          domId: 'ai-main-1',
          label: 'Flexible travel ideas and popular destinations from Sweden',
          role: 'generic',
          selector: 'div',
        },
        e2: {
          domId: 'ai-main-2',
          label: 'Change appearance',
          role: 'generic',
          selector: 'button',
        },
        e3: {
          domId: 'ai-main-3',
          label: 'Flights Round trip 1 Economy Stockholm Departure Return',
          role: 'generic',
          selector: 'div',
        },
      },
      expectedFrameIds: [],
      frameArtifacts: [],
      timedOut: false,
    },
    frameSnapshots: [],
    fullPageScreenshot: null,
    observedAt: '2026-04-08T00:00:00.000Z',
    quiescence: {
      idleThresholdMs: 300,
      lastActivityAt: null,
      observedFrameCount: 1,
      satisfied: true,
      timedOut: false,
      waitTimeMs: 300,
    },
    screenshot: {
      capturedAt: '2026-04-08T00:00:00.000Z',
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

describe('invalid target repair', () => {
  it('repairs a text-entry action with a textual id into a click on the best matching ref', () => {
    const repair = repairInvalidTargetAction({
      action: 'type',
      observation: createObservationResult(),
      params: { id: 'Stockholm', text: 'Stockholm' },
      targetState: 'unknown_ref',
    });

    expect(repair).toEqual({
      action: 'click',
      candidateRef: 'e3',
      params: { id: 'e3' },
      reason:
        'Repaired invalid target "Stockholm" to ref "e3" for text-entry setup.',
      score: repair?.score,
    });
    expect(repair?.score ?? 0).toBeGreaterThan(0);
  });

  it('does not repair actions that already target a known ref', () => {
    const repair = repairInvalidTargetAction({
      action: 'type',
      observation: createObservationResult(),
      params: { id: 'e3', text: 'Stockholm' },
      targetState: 'known_ref',
    });

    expect(repair).toBeNull();
  });

  it('treats dialog-opening repair clicks as progress', () => {
    const validation: ValidationResult = {
      outcome: 'blocked',
      reason: 'A dialog or overlay appeared after the action.',
      signals: {
        axDelta: { added: 8, removed: 0, total: 8 },
        focusChanged: false,
        loadingChanged: false,
        scrollChanged: false,
        targetStillPresent: true,
        targetWasKnown: true,
        urlChanged: false,
      },
    };

    expect(normalizeInvalidTargetRepairValidation(validation)).toEqual({
      ...validation,
      outcome: 'success',
      reason:
        'Clicked a likely text-entry container and opened a dialog or overlay for retargeting.',
    });
  });
});
