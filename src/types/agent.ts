export type ToolName =
  | 'click'
  | 'tap_coordinates'
  | 'type'
  | 'fill'
  | 'select'
  | 'gettext'
  | 'hover'
  | 'focus'
  | 'eval'
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

export type ObservationRefEntry = {
  domId: string;
  role: string;
  label: string;
  selector: string;
};

export type AgentActionStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'no_op'
  | 'partial_success'
  | 'blocked'
  | 'stale_ref';

export type AgentActionRecord = {
  action: ToolName;
  parameters: Record<string, unknown>;
  status: AgentActionStatus;
  reason: string | null;
  urlBefore: string | null;
  urlAfter: string | null;
  timestamp: string;
  /** Timestamp of the original action this retried (if a fallback). */
  retryOf?: string;
  /** Escalation path taken for this action. */
  fallbackChain?: ToolName[];
};

export type PlanPhase =
  | 'initial'
  | 'search'
  | 'results'
  | 'detail'
  | 'form'
  | 'checkout'
  | 'blocked'
  | 'done';

export type PlanItemStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'dropped';

export type PlanItemSource = 'system' | 'model';

export type PlanningContextReason =
  | 'post_navigation'
  | 'repeated_failure'
  | 'sparse_refs'
  | 'plan_ambiguity';

export type InferencePlanningContext = {
  fullPageScreenshotUri: string;
  reasons: PlanningContextReason[];
  summary: string;
};

export type PlanningContextDebugRequest = {
  fullPageCaptured: boolean;
  fullPageScreenshotUri: string | null;
  reasons: PlanningContextReason[];
  source: 'planning' | 'debug_raw' | 'planning_and_debug_raw';
  step: number;
  summary: string;
  url: string | null;
};

export type PlanUpdateType =
  | 'add_item'
  | 'set_active_item'
  | 'complete_item'
  | 'reopen_item'
  | 'drop_item'
  | 'set_phase';

export type PlanUpdateProposal = {
  type: PlanUpdateType;
  id?: string;
  text?: string;
  phase?: PlanPhase;
  activate?: boolean;
  evidence?: string;
  reason?: string;
};

export type PlanItem = {
  id: string;
  text: string;
  status: PlanItemStatus;
  source: PlanItemSource;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AvoidRef = {
  ref: string;
  reason: string;
  expiresAfterStep: number;
};

export type SessionPlan = {
  phase: PlanPhase;
  activeItemId: string | null;
  lastConfirmedProgress: string | null;
  items: PlanItem[];
  avoidRefs: AvoidRef[];
  notes: string[];
  updatedAt: string;
};

export type InferenceRequest = {
  goal: string;
  screenshotUri: string;
  planningContext: InferencePlanningContext | null;
  axSnapshot: AxNode[];
  axTreeText: string;
  actionHistory: AgentActionRecord[];
  sessionPlan: SessionPlan | null;
  runtimeMode: RuntimeMode;
};

export type InferenceSuccess = {
  ok: true;
  action: ToolName;
  parameters: Record<string, unknown>;
  planUpdates: PlanUpdateProposal[] | null;
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

export type FullPageCapture = ViewportCapture & {
  tileCount: number;
  viewportOriginX: number;
  viewportOriginY: number;
  viewportPointWidth: number;
  viewportPointHeight: number;
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
  fullPageScreenshot: FullPageCapture | null;
  axSnapshot: AxNode[];
  axTreeText: string;
  frameSnapshots: ObservationFrameSnapshot[];
  debug: {
    combinedRefMap: Record<string, ObservationRefEntry>;
    expectedFrameIds: string[];
    frameArtifacts: {
      error: string | null;
      frameId: string;
      frameTitle: string | null;
      frameUrl: string | null;
      isTopFrame: boolean;
      nodeCount: number;
      observedAt: string | null;
      refIds: string[];
      refMap: Record<string, ObservationRefEntry>;
      treeText: string;
    }[];
    timedOut: boolean;
  };
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
  | 'retrying'
  | 'yielded'
  | 'finished'
  | 'failed';

export type StopReason =
  | 'goal_complete'
  | 'yielded_to_user'
  | 'step_budget_exhausted'
  | 'time_budget_exhausted'
  | 'consecutive_no_ops'
  | 'repeated_identical_failure'
  | 'unrecoverable_error'
  | 'modal_blocked'
  | 'user_cancelled'
  | 'app_backgrounded';
