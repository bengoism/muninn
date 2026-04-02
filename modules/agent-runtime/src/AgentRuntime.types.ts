export type {
  AgentActionRecord,
  AxNode,
  InferenceRequest,
  InferenceResponse,
  LoopState,
  ToolName,
} from '../../../src/types/agent';

import type { StyleProp, ViewStyle } from 'react-native';

export type OnLoadEventPayload = {
  url: string;
};

export type AgentRuntimeViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: OnLoadEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};
