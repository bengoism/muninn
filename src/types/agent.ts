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

export type AxNode = {
  id: string;
  role: string;
  label: string | null;
  value: string | null;
  bounds: Bounds;
  isVisible: boolean;
  isEnabled: boolean;
  frameId: string | null;
  frameUrl: string | null;
  valueRedacted: boolean;
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

export type LoopState =
  | 'idle'
  | 'observing'
  | 'reasoning'
  | 'acting'
  | 'validating'
  | 'yielded'
  | 'finished'
  | 'failed';
