import { NativeModule, requireNativeModule } from 'expo';

import type {
  InferenceRequest,
  InferenceResponse,
  ModelCatalogEntry,
  ModelStatus,
} from './AgentRuntime.types';

declare class AgentRuntimeModule extends NativeModule {
  runInference(request: InferenceRequest): Promise<InferenceResponse>;
  listAvailableModels(): Promise<ModelCatalogEntry[]>;
  getModelStatus(): Promise<ModelStatus>;
  downloadModel(modelId: string): Promise<ModelStatus>;
}

export default requireNativeModule<AgentRuntimeModule>('AgentRuntime');
