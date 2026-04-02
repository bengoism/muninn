import { NativeModule, requireNativeModule } from 'expo';

import type { InferenceRequest, InferenceResponse } from './AgentRuntime.types';

declare class AgentRuntimeModule extends NativeModule {
  runInference(request: InferenceRequest): Promise<InferenceResponse>;
}

export default requireNativeModule<AgentRuntimeModule>('AgentRuntime');
