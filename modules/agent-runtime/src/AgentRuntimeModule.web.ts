import { registerWebModule, NativeModule } from 'expo';

import type { InferenceRequest, InferenceResponse } from './AgentRuntime.types';

class AgentRuntimeModule extends NativeModule {
  async runInference(request: InferenceRequest): Promise<InferenceResponse> {
    return {
      action: 'finish',
      parameters: {
        status: 'stubbed',
        message: `Web stub received goal "${request.goal}" with ${request.axSnapshot.length} accessibility nodes.`,
      },
    };
  }
}

export default registerWebModule(AgentRuntimeModule, 'AgentRuntime');
