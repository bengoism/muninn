import type { Bounds, ObservationRefEntry } from '../../types/agent';

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

export type BrowserObservationStatePayload = {
  pendingRequestCount: number;
  lastActivityAt: string;
  reason: string;
};

export type BrowserFrameLinkPayload = {
  childFrameId: string;
  parentFrameId: string;
  bounds: Bounds;
  isVisible: boolean;
};

export type BrowserAxSnapshotNodePayload = {
  id: string;
  role: string;
  label: string | null;
  value: string | null;
  text: string | null;
  placeholder: string | null;
  bounds: Bounds;
  isVisible: boolean;
  isHidden: boolean;
  isEnabled: boolean;
  frameId: string | null;
  frameUrl: string | null;
  valueRedacted: boolean;
  redactionReason: string | null;
};

export type BrowserAxSnapshotRefEntry = {
  domId: string;
  hasSemanticDescendants?: boolean;
  href?: string | null;
  role: string;
  label: string;
  placeholder?: string | null;
  selector: string;
  snapshotId?: string;
  tagName?: string;
  targetType?: 'semantic' | 'generic';
  text?: string;
};

export type BrowserConsoleMessageLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export type BrowserConsoleMessagePayload = {
  args: (Record<string, unknown> | string | number | boolean | null)[];
  level: BrowserConsoleMessageLevel;
};

export type BrowserNetworkSummaryPhase =
  | 'started'
  | 'completed'
  | 'failed'
  | 'send_beacon';

export type BrowserNetworkSummaryPayload = {
  durationMs: number | null;
  error: string | null;
  method: string;
  phase: BrowserNetworkSummaryPhase;
  requestId: string;
  statusCode: number | null;
  transport: 'fetch' | 'xhr' | 'beacon';
  url: string;
};

export type BrowserAxSnapshotPayload = {
  requestId: string;
  nodes: BrowserAxSnapshotNodePayload[];
  treeText: string;
  refMap: Record<string, ObservationRefEntry>;
  observedAt: string;
};

export type BrowserAxSnapshotErrorPayload = {
  requestId: string;
  message: string;
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

export type BrowserConsoleMessage = BrowserBridgeEnvelopeBase & {
  kind: 'console_message';
  payload: BrowserConsoleMessagePayload;
};

export type BrowserNetworkSummaryMessage = BrowserBridgeEnvelopeBase & {
  kind: 'network_summary';
  payload: BrowserNetworkSummaryPayload;
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

export type BrowserObservationStateMessage = BrowserBridgeEnvelopeBase & {
  kind: 'observation_state';
  payload: BrowserObservationStatePayload;
};

export type BrowserFrameLinkMessage = BrowserBridgeEnvelopeBase & {
  kind: 'frame_link';
  payload: BrowserFrameLinkPayload;
};

export type BrowserAxSnapshotMessage = BrowserBridgeEnvelopeBase & {
  kind: 'ax_snapshot';
  payload: BrowserAxSnapshotPayload;
};

export type BrowserAxSnapshotErrorMessage = BrowserBridgeEnvelopeBase & {
  kind: 'ax_snapshot_error';
  payload: BrowserAxSnapshotErrorPayload;
};

// Untrusted telemetry emitted from page-world JavaScript. Never use this as an
// authenticity boundary for agent control flow.
export type BrowserBridgeMessage =
  | BrowserBridgeReadyMessage
  | BrowserPageEventMessage
  | BrowserConsoleMessage
  | BrowserNetworkSummaryMessage
  | BrowserScriptErrorMessage
  | BrowserObservationStateMessage
  | BrowserFrameLinkMessage
  | BrowserAxSnapshotMessage
  | BrowserAxSnapshotErrorMessage
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
