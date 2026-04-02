export type BrowserFixtureId = 'bridge';

export type BrowserFrameMetadata = {
  frameId: string;
  url: string;
  title: string | null;
  isTopFrame: boolean;
  readyState: string | null;
};

export type BrowserPageEventType =
  | 'bootstrap'
  | 'ready_state'
  | 'load'
  | 'pageshow'
  | 'hashchange'
  | 'popstate'
  | 'post_content_injected'
  | 'bridge_reused';

export type BrowserPageEventPayload = {
  event: BrowserPageEventType;
  detail: Record<string, unknown> | null;
};

export type BrowserScriptErrorPayload = {
  source: 'window_error' | 'unhandledrejection' | 'bridge';
  name: string;
  message: string;
  stack: string | null;
};

export type BrowserBridgeReadyPayload = {
  bridgeVersion: string;
  readyState: string | null;
  reused: boolean;
  userAgent: string;
};

export type BrowserEvaluationErrorType =
  | 'native_unavailable'
  | 'timeout'
  | 'execution_error'
  | 'serialization_error'
  | 'navigation_changed'
  | 'protocol_error';

export type BrowserEvaluationResultPayload = {
  requestId: string;
  value: unknown;
};

export type BrowserEvaluationErrorPayload = {
  requestId: string;
  code: BrowserEvaluationErrorType;
  message: string;
  details: unknown;
};

type BrowserBridgeEnvelopeBase = {
  channel: string;
  timestamp: string;
  frame: BrowserFrameMetadata;
};

export type BrowserBridgeReadyMessage = BrowserBridgeEnvelopeBase & {
  kind: 'bridge_ready';
  payload: BrowserBridgeReadyPayload;
};

export type BrowserPageEventMessage = BrowserBridgeEnvelopeBase & {
  kind: 'page_event';
  payload: BrowserPageEventPayload;
};

export type BrowserScriptErrorMessage = BrowserBridgeEnvelopeBase & {
  kind: 'script_error';
  payload: BrowserScriptErrorPayload;
};

export type BrowserEvaluationResultMessage = BrowserBridgeEnvelopeBase & {
  kind: 'eval_result';
  payload: BrowserEvaluationResultPayload;
};

export type BrowserEvaluationErrorMessage = BrowserBridgeEnvelopeBase & {
  kind: 'eval_error';
  payload: BrowserEvaluationErrorPayload;
};

// Untrusted telemetry emitted from page-world JavaScript. Never use this as an
// authenticity boundary for agent control flow.
export type BrowserBridgeMessage =
  | BrowserBridgeReadyMessage
  | BrowserPageEventMessage
  | BrowserScriptErrorMessage
  | BrowserEvaluationResultMessage
  | BrowserEvaluationErrorMessage;

export type BrowserBridgeParseError = {
  type: 'protocol_error';
  message: string;
  raw: string;
};

export type BrowserNavigationStateSnapshot = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
  url: string;
};

export type BrowserNavigationError = {
  type: 'navigation_error' | 'http_error';
  url: string;
  description: string;
  code?: number;
  statusCode?: number;
};

export type BrowserEvaluationSuccess<T = unknown> = {
  ok: true;
  requestId: string;
  value: T;
  frame?: BrowserFrameMetadata;
  elapsedMs: number;
};

export type BrowserEvaluationFailure = {
  ok: false;
  requestId: string;
  type: BrowserEvaluationErrorType;
  message: string;
  details?: unknown;
  frame?: BrowserFrameMetadata;
  elapsedMs: number;
};

export type BrowserEvaluationResult<T = unknown> =
  | BrowserEvaluationSuccess<T>
  | BrowserEvaluationFailure;
