import { create } from 'zustand';

import type { ObservationResult } from '../types/agent';
import type {
  BrowserConsoleMessage,
  BrowserNetworkSummaryMessage,
  BrowserPageEventMessage,
} from '../features/browser/types';
import type {
  ActionDebugTrace,
  LocatorProbeTrace,
} from '../features/browser/debug/types';

const MAX_ACTION_TRACES = 30;
const MAX_CONSOLE_MESSAGES = 80;
const MAX_NETWORK_EVENTS = 80;
const MAX_PAGE_EVENTS = 40;

type DebugState = {
  actionTraces: ActionDebugTrace[];
  captureRaw: boolean;
  consoleMessages: BrowserConsoleMessage[];
  lastLocatorProbe: LocatorProbeTrace | null;
  lastObservation: ObservationResult | null;
  networkEvents: BrowserNetworkSummaryMessage[];
  pageEvents: BrowserPageEventMessage[];
  clearSession: () => void;
  pushActionTrace: (trace: ActionDebugTrace) => void;
  pushConsoleMessage: (message: BrowserConsoleMessage) => void;
  pushNetworkEvent: (message: BrowserNetworkSummaryMessage) => void;
  pushPageEvent: (message: BrowserPageEventMessage) => void;
  setCaptureRaw: (value: boolean) => void;
  setLastLocatorProbe: (probe: LocatorProbeTrace | null) => void;
  setLastObservation: (observation: ObservationResult | null) => void;
};

function pushBounded<T>(items: T[], item: T, limit: number) {
  return [...items, item].slice(-limit);
}

export const useDebugStore = create<DebugState>((set) => ({
  actionTraces: [],
  captureRaw: false,
  consoleMessages: [],
  lastLocatorProbe: null,
  lastObservation: null,
  networkEvents: [],
  pageEvents: [],
  clearSession: () =>
    set({
      actionTraces: [],
      consoleMessages: [],
      lastLocatorProbe: null,
      lastObservation: null,
      networkEvents: [],
      pageEvents: [],
    }),
  pushActionTrace: (trace) =>
    set((state) => ({
      actionTraces: pushBounded(state.actionTraces, trace, MAX_ACTION_TRACES),
    })),
  pushConsoleMessage: (message) =>
    set((state) => ({
      consoleMessages: pushBounded(
        state.consoleMessages,
        message,
        MAX_CONSOLE_MESSAGES,
      ),
    })),
  pushNetworkEvent: (message) =>
    set((state) => ({
      networkEvents: pushBounded(
        state.networkEvents,
        message,
        MAX_NETWORK_EVENTS,
      ),
    })),
  pushPageEvent: (message) =>
    set((state) => ({
      pageEvents: pushBounded(state.pageEvents, message, MAX_PAGE_EVENTS),
    })),
  setCaptureRaw: (captureRaw) => set({ captureRaw }),
  setLastLocatorProbe: (lastLocatorProbe) => set({ lastLocatorProbe }),
  setLastObservation: (lastObservation) => set({ lastObservation }),
}));
