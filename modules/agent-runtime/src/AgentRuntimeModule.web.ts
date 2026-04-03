import { registerWebModule, NativeModule } from 'expo';

import type { InferenceRequest, InferenceResponse } from './AgentRuntime.types';

class AgentRuntimeModule extends NativeModule {
  async runInference(request: InferenceRequest): Promise<InferenceResponse> {
    return {
      ok: true,
      action: 'finish',
      parameters: {
        status: 'replay',
        message: `Web stub received goal "${request.goal}" with ${request.axSnapshot.length} accessibility nodes.`,
      },
      backend: 'web-stub',
      diagnostics: {
        actionHistoryCount: request.actionHistory.length,
        screenshotUri: request.screenshotUri,
      },
    };
  }
}

export default registerWebModule(AgentRuntimeModule, 'AgentRuntime');
