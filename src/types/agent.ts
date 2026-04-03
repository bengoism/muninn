export type ToolName =
  | 'click'
  | 'tap_coordinates'
  | 'type'
  | 'scroll'
  | 'go_back'
  | 'wait'
  | 'yield_to_user'
  | 'finish';

export type RuntimeMode = 'replay' | 'litertlm';

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type AxNode = {
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
  frameOrigin: Point | null;
  valueRedacted: boolean;
  redactionReason: string | null;
};

export type AgentActionRecord = {
  action: ToolName;
  parameters: Record<string, unknown>;
  status: 'pending' | 'succeeded' | 'failed';
  reason: string | null;
  urlBefore: string | null;
  urlAfter: string | null;
  timestamp: string;
};

export type InferenceRequest = {
  goal: string;
  screenshotUri: string;
  axSnapshot: AxNode[];
  actionHistory: AgentActionRecord[];
  runtimeMode: RuntimeMode;
};

export type InferenceSuccess = {
  ok: true;
  action: ToolName;
  parameters: Record<string, unknown>;
  backend: string;
  diagnostics: Record<string, unknown> | null;
};

export type InferenceFailureCode =
  | 'invalid_request'
  | 'screenshot_not_found'
  | 'screenshot_load_failed'
  | 'model_not_configured'
  | 'model_load_failed'
  | 'invalid_model_output'
  | 'unsupported_action'
  | 'missing_parameter'
  | 'memory_pressure'
  | 'timeout'
  | 'internal_error';

export type InferenceFailure = {
  ok: false;
  code: InferenceFailureCode;
  message: string;
  details: Record<string, unknown> | null;
  retryable: boolean;
  backend: string;
};

export type InferenceResponse = InferenceSuccess | InferenceFailure;

export type LiteRTLMSmokeTestSuccess = {
  ok: true;
  text: string;
  backend: string;
  diagnostics: Record<string, unknown> | null;
};

export type LiteRTLMSmokeTestResponse =
  | LiteRTLMSmokeTestSuccess
  | InferenceFailure;

export type ModelCatalogEntry = {
  id: string;
  displayName: string;
  modelId: string;
  commitHash: string;
  filename: string;
  approximateSizeBytes: number;
  downloaded: boolean;
  active: boolean;
};

export type ModelStatus = {
  activeModelId: string | null;
  activeCommitHash: string | null;
  isDownloading: boolean;
  downloadedBytes: number;
  totalBytes: number;
  lastError: string | null;
};

export type ViewportCapture = {
  uri: string;
  width: number;
  height: number;
  pointWidth: number;
  pointHeight: number;
  scale: number;
  orientation: 'portrait' | 'landscape';
  capturedAt: string;
};

export type ObservationQuiescence = {
  satisfied: boolean;
  timedOut: boolean;
  waitTimeMs: number;
  idleThresholdMs: number;
  observedFrameCount: number;
  lastActivityAt: string | null;
};

export type ObservationFrameSnapshot = {
  frameId: string;
  frameUrl: string | null;
  frameTitle: string | null;
  parentFrameId: string | null;
  frameBounds: Bounds | null;
  frameOrigin: Point | null;
  nodeCount: number;
  observedAt: string | null;
  timedOut: boolean;
  error: string | null;
};

export type ObservationResult = {
  screenshot: ViewportCapture;
  axSnapshot: AxNode[];
  frameSnapshots: ObservationFrameSnapshot[];
  warnings: string[];
  quiescence: ObservationQuiescence;
  observedAt: string;
};

export type LoopState =
  | 'idle'
  | 'observing'
  | 'reasoning'
  | 'acting'
  | 'validating'
  | 'yielded'
  | 'finished'
  | 'failed';
