import { registerWebModule, NativeModule } from 'expo';

import type {
  InferenceRequest,
  InferenceResponse,
  LiteRTLMSmokeTestResponse,
  ModelCatalogEntry,
  ModelStatus,
} from './AgentRuntime.types';

class AgentRuntimeModule extends NativeModule {
  async runInference(request: InferenceRequest): Promise<InferenceResponse> {
    return {
      ok: true,
      action: 'finish',
      parameters: {
        status: 'replay',
        message: `Web stub received goal "${request.goal}" with ${request.axSnapshot.length} accessibility nodes.`,
      },
      planUpdates: null,
      backend: 'web-stub',
      diagnostics: {
        actionHistoryCount: request.actionHistory.length,
        planningContextReasons: request.planningContext?.reasons ?? [],
        planningImageProvided: request.planningContext !== null,
        planPhase: request.sessionPlan?.phase ?? null,
        screenshotUri: request.screenshotUri,
      },
    };
  }

  async runLiteRTLMSmokeTest(): Promise<LiteRTLMSmokeTestResponse> {
    return {
      ok: false,
      code: 'model_load_failed',
      message: 'LiteRT-LM text smoke tests are unavailable on the web stub.',
      details: null,
      retryable: false,
      backend: 'web-stub',
    };
  }

  async listAvailableModels(): Promise<ModelCatalogEntry[]> {
    return [];
  }

  async getModelStatus(): Promise<ModelStatus> {
    return {
      activeModelId: null,
      activeCommitHash: null,
      isDownloading: false,
      downloadedBytes: 0,
      totalBytes: 0,
      lastError: 'Model downloads are unavailable on the web stub.',
    };
  }

  async downloadModel(): Promise<ModelStatus> {
    return this.getModelStatus();
  }
}

export default registerWebModule(AgentRuntimeModule, 'AgentRuntime');
