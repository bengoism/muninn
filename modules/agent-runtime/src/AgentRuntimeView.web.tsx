import * as React from 'react';

import { AgentRuntimeViewProps } from './AgentRuntime.types';

export default function AgentRuntimeView(props: AgentRuntimeViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
