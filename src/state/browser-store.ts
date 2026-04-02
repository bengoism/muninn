import { create } from 'zustand';

import { DEFAULT_BROWSER_URL } from '../config/runtime';
import {
  BRIDGE_FIXTURE_BASE_URL,
  BRIDGE_FIXTURE_URL,
} from '../features/browser/fixtures/bridge-fixture';
import type {
  BrowserBridgeMessage,
  BrowserBridgeParseError,
  BrowserFrameMetadata,
  BrowserNavigationError,
  BrowserNavigationStateSnapshot,
  BrowserScriptErrorMessage,
} from '../features/browser/types';

type BrowserState = {
  requestedUrl: string;
  currentUrl: string;
  title: string;
  progress: number;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  telemetryReady: boolean;
  mainFrameId: string | null;
  frames: Record<string, BrowserFrameMetadata>;
  lastNavigationError: BrowserNavigationError | null;
  lastScriptError: BrowserScriptErrorMessage | null;
  lastTelemetryProtocolError: BrowserBridgeParseError | null;
  lastTelemetryMessage: BrowserBridgeMessage | null;
  setRequestedUrl: (url: string) => void;
  applyNavigationState: (navigationState: BrowserNavigationStateSnapshot) => void;
  setProgress: (progress: number) => void;
  setNavigationError: (error: BrowserNavigationError | null) => void;
  clearTelemetryState: () => void;
  registerTelemetryMessage: (message: BrowserBridgeMessage) => void;
  setTelemetryProtocolError: (error: BrowserBridgeParseError | null) => void;
};

export const useBrowserStore = create<BrowserState>((set) => ({
  requestedUrl: DEFAULT_BROWSER_URL,
  currentUrl: DEFAULT_BROWSER_URL,
  title: '',
  progress: 0,
  isLoading: true,
  canGoBack: false,
  canGoForward: false,
  telemetryReady: false,
  mainFrameId: null,
  frames: {},
  lastNavigationError: null,
  lastScriptError: null,
  lastTelemetryProtocolError: null,
  lastTelemetryMessage: null,
  setRequestedUrl: (requestedUrl) =>
    set({
      requestedUrl,
      lastNavigationError: null,
    }),
  applyNavigationState: (navigationState) =>
    set((state) => ({
      requestedUrl:
        state.requestedUrl === BRIDGE_FIXTURE_URL &&
        navigationState.url.startsWith(BRIDGE_FIXTURE_BASE_URL)
          ? BRIDGE_FIXTURE_URL
          : navigationState.url,
      currentUrl: navigationState.url,
      title: navigationState.title,
      isLoading: navigationState.isLoading,
      canGoBack: navigationState.canGoBack,
      canGoForward: navigationState.canGoForward,
      lastNavigationError: null,
    })),
  setProgress: (progress) =>
    set({
      progress,
      isLoading: progress < 1,
    }),
  setNavigationError: (lastNavigationError) =>
    set({
      lastNavigationError,
    }),
  clearTelemetryState: () =>
    set({
      telemetryReady: false,
      mainFrameId: null,
      frames: {},
      lastTelemetryMessage: null,
      lastScriptError: null,
      lastTelemetryProtocolError: null,
    }),
  registerTelemetryMessage: (message) =>
    set((state) => {
      const frames = {
        ...state.frames,
        [message.frame.frameId]: message.frame,
      };

      const telemetryReady =
        message.kind === 'bridge_ready' && message.frame.isTopFrame
        ? true
        : state.telemetryReady;
      const mainFrameId =
        message.frame.isTopFrame && message.kind === 'bridge_ready'
          ? message.frame.frameId
          : state.mainFrameId;

      return {
        frames,
        telemetryReady,
        mainFrameId,
        lastScriptError:
          message.kind === 'script_error' ? message : state.lastScriptError,
        lastTelemetryMessage: message,
      };
    }),
  setTelemetryProtocolError: (lastTelemetryProtocolError) =>
    set({
      lastTelemetryProtocolError,
    }),
}));
