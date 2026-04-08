import type { StyleProp, ViewStyle } from 'react-native';
import type { FullPageCapture, ViewportCapture } from '../../../src/types/agent';

export type BrowserHostNavigationStatePayload = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
  url: string;
};

export type BrowserHostNavigationErrorPayload = {
  code?: number;
  description: string;
  statusCode?: number;
  type: 'navigation_error' | 'http_error';
  url: string;
};

export type BrowserHostProgressPayload = {
  progress: number;
};

export type BrowserHostLoadStartPayload = {
  url: string;
};

export type BrowserHostTelemetryPayload = {
  data: string;
};

export type BrowserHostEvaluationOutcome =
  | {
      ok: true;
      value: unknown;
    }
  | {
      code: 'execution_error' | 'serialization_error';
      details?: unknown;
      message: string;
      ok: false;
    };

export type BrowserHostViewportCaptureOutcome =
  | {
      ok: true;
      capture: ViewportCapture;
    }
  | {
      code: 'capture_unavailable' | 'capture_failed' | 'write_failed';
      details?: unknown;
      message: string;
      ok: false;
    };

export type BrowserHostFullPageCaptureOutcome =
  | {
      ok: true;
      capture: FullPageCapture;
    }
  | {
      code: 'capture_unavailable' | 'capture_failed' | 'write_failed';
      details?: unknown;
      message: string;
      ok: false;
    };

export type BrowserHostViewProps = {
  afterContentScript?: string | null;
  bootstrapScript?: string | null;
  onLoadProgress?: (event: { nativeEvent: BrowserHostProgressPayload }) => void;
  onLoadStart?: (event: { nativeEvent: BrowserHostLoadStartPayload }) => void;
  onNavigationError?: (event: {
    nativeEvent: BrowserHostNavigationErrorPayload;
  }) => void;
  onNavigationStateChange?: (event: {
    nativeEvent: BrowserHostNavigationStatePayload;
  }) => void;
  onTelemetryMessage?: (event: { nativeEvent: BrowserHostTelemetryPayload }) => void;
  sourceBaseUrl?: string | null;
  sourceHtml?: string | null;
  sourceUrl?: string | null;
  style?: StyleProp<ViewStyle>;
};

export type BrowserHostViewHandle = {
  captureFullPage: () => Promise<BrowserHostFullPageCaptureOutcome>;
  captureViewport: () => Promise<BrowserHostViewportCaptureOutcome>;
  evaluateJavaScript: (
    source: string
  ) => Promise<BrowserHostEvaluationOutcome>;
  goBack: () => Promise<null>;
  goForward: () => Promise<null>;
  nativeTag: number | null;
  reload: () => Promise<null>;
  stopLoading: () => Promise<null>;
};
