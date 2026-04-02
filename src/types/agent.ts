export type ToolName =
  | 'click'
  | 'tap_coordinates'
  | 'type'
  | 'scroll'
  | 'go_back'
  | 'wait'
  | 'yield_to_user'
  | 'finish';

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
  timestamp: string;
};

export type InferenceRequest = {
  goal: string;
  screenshotUri: string;
  axSnapshot: AxNode[];
  actionHistory: AgentActionRecord[];
};

export type InferenceResponse = {
  action: ToolName;
  parameters: Record<string, unknown>;
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
