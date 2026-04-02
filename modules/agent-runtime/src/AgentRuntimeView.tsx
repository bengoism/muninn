import { requireNativeView } from 'expo';
import * as React from 'react';

import { AgentRuntimeViewProps } from './AgentRuntime.types';

const NativeView: React.ComponentType<AgentRuntimeViewProps> =
  requireNativeView('AgentRuntime');

export default function AgentRuntimeView(props: AgentRuntimeViewProps) {
  return <NativeView {...props} />;
}
