import { create } from 'zustand';

import { DEFAULT_BROWSER_URL } from '../config/runtime';
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
  bridgeReady: boolean;
  mainFrameId: string | null;
  frames: Record<string, BrowserFrameMetadata>;
  lastNavigationError: BrowserNavigationError | null;
  lastScriptError: BrowserScriptErrorMessage | null;
  lastBridgeProtocolError: BrowserBridgeParseError | null;
  lastBridgeMessage: BrowserBridgeMessage | null;
  setRequestedUrl: (url: string) => void;
  applyNavigationState: (navigationState: BrowserNavigationStateSnapshot) => void;
  setProgress: (progress: number) => void;
  setNavigationError: (error: BrowserNavigationError | null) => void;
  clearBridgeState: () => void;
  registerBridgeMessage: (message: BrowserBridgeMessage) => void;
  setBridgeProtocolError: (error: BrowserBridgeParseError | null) => void;
};

export const useBrowserStore = create<BrowserState>((set) => ({
  requestedUrl: DEFAULT_BROWSER_URL,
  currentUrl: DEFAULT_BROWSER_URL,
  title: '',
  progress: 0,
  isLoading: true,
  canGoBack: false,
  canGoForward: false,
  bridgeReady: false,
  mainFrameId: null,
  frames: {},
  lastNavigationError: null,
  lastScriptError: null,
  lastBridgeProtocolError: null,
  lastBridgeMessage: null,
  setRequestedUrl: (requestedUrl) =>
    set({
      requestedUrl,
      lastNavigationError: null,
    }),
  applyNavigationState: (navigationState) =>
    set({
      currentUrl: navigationState.url,
      title: navigationState.title,
      isLoading: navigationState.isLoading,
      canGoBack: navigationState.canGoBack,
      canGoForward: navigationState.canGoForward,
      lastNavigationError: null,
    }),
  setProgress: (progress) =>
    set({
      progress,
      isLoading: progress < 1,
    }),
  setNavigationError: (lastNavigationError) =>
    set({
      lastNavigationError,
    }),
  clearBridgeState: () =>
    set({
      bridgeReady: false,
      mainFrameId: null,
      frames: {},
      lastBridgeMessage: null,
      lastScriptError: null,
      lastBridgeProtocolError: null,
    }),
  registerBridgeMessage: (message) =>
    set((state) => {
      const frames = {
        ...state.frames,
        [message.frame.frameId]: message.frame,
      };

      const bridgeReady = message.kind === 'bridge_ready' && message.frame.isTopFrame
        ? true
        : state.bridgeReady;
      const mainFrameId =
        message.frame.isTopFrame && message.kind === 'bridge_ready'
          ? message.frame.frameId
          : state.mainFrameId;

      return {
        frames,
        bridgeReady,
        mainFrameId,
        lastScriptError:
          message.kind === 'script_error' ? message : state.lastScriptError,
        lastBridgeMessage: message,
      };
    }),
  setBridgeProtocolError: (lastBridgeProtocolError) =>
    set({
      lastBridgeProtocolError,
    }),
}));
